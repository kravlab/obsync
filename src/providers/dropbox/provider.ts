/**
 * The Dropbox Provider (spec, "Dropbox provider" and "Provider contract"):
 * one Remote, a subfolder of the App Folder, through Dropbox's HTTP API.
 *
 * - `list` is a recursive `list_folder` of the root, paged.
 * - `read` is `get_metadata`, then `files/download` of that revision;
 *   `write` is `files/upload`, or an upload session for a file above the
 *   Per-request limit, which downloads also keep to (transfers.ts).
 * - `delete` is `delete_v2`.
 * - Conditional writes are upload modes (`add` for "absent", `update` with
 *   the known `rev`) and `delete_v2` with `parent_rev`, files only.
 *
 * Remote paths are relative to the root, which is an App-Folder path such
 * as "/My vault", as the connect step chose it.
 */
import type { Connection, ProviderConnector } from "../../engine/ports";
import {
	ProviderError,
	type Change,
	type ChangeBatch,
	type Listing,
	type NameRules,
	type Precondition,
	type Provider,
	type RemoteEntry,
	type RemoteFile,
	type RemotePath,
} from "../../engine/provider";
import { DropboxClient } from "./client";
import type { DropboxOptions, DropboxTransfers } from "./options";
import { WRITE_RETRY_AFTER_MS, writeFailure, type Tagged } from "./errors";
import { downloadFile, uploadFile, type TransferRules } from "./transfers";
import { fileRevision, listFolder, listFolderContinue, routeFailure, summary, writeErrorOf, type Metadata } from "./routes";

/**
 * The largest file this provider accepts: the most an upload session
 * takes, 2^41 - 2^22 bytes (Dropbox API spec, `upload_session/append:2`).
 */
const MAX_FILE_SIZE = 2 ** 41 - 2 ** 22;

/**
 * Dropbox paths are case-insensitive. Its other name rules are not
 * declared yet: a name it refuses fails with `nameNotRepresentable`.
 */
const NAME_RULES: NameRules = { forbiddenCharacters: [], reservedNames: [], caseInsensitive: true };

/** The id naming Dropbox in Connections and in the login secret's id. */
export const DROPBOX_PROVIDER_ID = "dropbox";

/**
 * Builds the connector that opens a Connection's Remote on Dropbox. Each
 * Provider it opens keeps to the Per-request limit set at that moment.
 */
export function createDropboxConnector({ appKey, http, clock, transfers }: DropboxOptions): ProviderConnector {
	return {
		providerId: DROPBOX_PROVIDER_ID,
		open(connection: Connection, secret: string): Promise<Provider> {
			const client = new DropboxClient(http, clock, appKey, secret);
			return Promise.resolve(createDropboxProvider(client, connection.remoteRoot, transfers));
		},
	};
}

/**
 * The Provider for the Remote at `root`, reached through `client`, with
 * no request or response body larger than the Per-request limit as
 * `transfers` gives it now.
 */
export function createDropboxProvider(client: DropboxClient, root: string, transfers: DropboxTransfers): Provider {
	const rules: TransferRules = { limit: transfers.requestLimit(), wait: transfers.wait };
	/** The App-Folder path of a Remote path. */
	const full = (path: RemotePath): string => `${root}/${path}`;

	return {
		capabilities: {
			conditionalWrite: true,
			changeFeed: {
				async changes(cursor: string): Promise<ChangeBatch> {
					const batch = await listFolderContinue(client, cursor);
					return { changes: remoteChanges(root, batch.entries, "list_folder/continue"), cursor: batch.cursor };
				},
			},
		},
		nameRules: NAME_RULES,
		maxFileSize: MAX_FILE_SIZE,

		async list(): Promise<Listing> {
			const batch = await listFolder(client, root, true);
			return { entries: remoteEntries(root, batch.entries), cursor: batch.cursor };
		},

		read(path) {
			return downloadFile(client, full(path), rules);
		},

		async write(path, data, precondition): Promise<RemoteFile> {
			const commit = { path: full(path), mode: writeMode(precondition), autorename: false, strict_conflict: true };
			const { rev, size } = await uploadFile(client, commit, data, rules);
			return { kind: "file", path, revision: rev, size };
		},

		async delete(path, precondition) {
			if (precondition?.kind === "absent") {
				throw new Error(`engine bug: a delete of ${path} cannot require it to be absent`);
			}
			const parentRev = precondition?.kind === "revision" ? { parent_rev: precondition.revision } : {};
			const result = await client.rpc("files/delete_v2", { path: full(path), ...parentRev });
			if (!result.ok) throw deleteFailure(result.error);
		},

		async createFolder(path) {
			const result = await client.rpc("files/create_folder_v2", { path: full(path), autorename: false });
			if (!result.ok) {
				const reason = writeErrorOf(result.error);
				// An existing folder is returned as it is (Provider contract).
				const inTheWay = reason?.[".tag"] === "conflict" ? (reason.conflict as Tagged | undefined) : undefined;
				if (inTheWay?.[".tag"] !== "folder") throw new ProviderError(writeFailure(reason), summary(result.error));
			}
			return { kind: "folder", path };
		},
	};
}

/**
 * The present entries below `root`, by Remote path: the changes of a full
 * listing with any `deleted` entries left out.
 */
function remoteEntries(root: string, listed: readonly Metadata[]): RemoteEntry[] {
	return remoteChanges(root, listed, "list_folder").filter((change): change is RemoteEntry => change.kind !== "deleted");
}

/**
 * The changes below `root`, by Remote path, from `route`. `path_display`
 * has the right case only in its last component, so each path is rebuilt
 * from the entries' own `name`s along `path_lower`; the root itself and
 * entries outside it are left out. The changes keep Dropbox's order, a
 * path appearing as often as Dropbox reports it, since each entry is to
 * be applied in turn. A file without its `rev` or `size` is a response
 * this provider cannot trust: it fails as `permanent`.
 */
function remoteChanges(root: string, listed: readonly Metadata[], route: string): Change[] {
	const rootLower = root.toLowerCase();
	const byLower = new Map<string, Metadata>();
	for (const entry of listed) {
		byLower.set(entry.path_lower, entry);
	}
	const paths = new Map<string, RemotePath>([[rootLower, ""]]);

	/** The Remote path of the entry at `lower`, from its ancestors' names. */
	function pathOf(lower: string, entry: Metadata): RemotePath {
		const known = paths.get(lower);
		if (known !== undefined) return known;
		const parentLower = lower.slice(0, lower.lastIndexOf("/"));
		const parent = byLower.get(parentLower);
		// A parent missing from the batch keeps its displayed name.
		const parentPath =
			parent === undefined
				? entry.path_display.slice(root.length + 1, entry.path_display.lastIndexOf("/"))
				: pathOf(parentLower, parent);
		const path = parentPath === "" ? entry.name : `${parentPath}/${entry.name}`;
		paths.set(lower, path);
		return path;
	}

	const changes: Change[] = [];
	for (const entry of listed) {
		const lower = entry.path_lower;
		if (!lower.startsWith(`${rootLower}/`)) continue;
		const path = pathOf(lower, entry);
		if (entry[".tag"] === "deleted") changes.push({ kind: "deleted", path });
		else if (entry[".tag"] === "folder") changes.push({ kind: "folder", path });
		else if (entry[".tag"] === "file") {
			const { rev, size } = fileRevision(entry, route);
			changes.push({ kind: "file", path, revision: rev, size });
		}
	}
	return changes;
}

/**
 * The upload `mode` for a precondition: `add` for "absent", `update` with
 * the revision, `overwrite` without one. Uploads are sent with
 * `strict_conflict`, so identical content and a deleted file still
 * conflict, as the precondition demands.
 */
function writeMode(precondition: Precondition | undefined): unknown {
	switch (precondition?.kind) {
		case undefined:
			return "overwrite";
		case "absent":
			return "add";
		case "revision":
			return { ".tag": "update", update: precondition.revision };
	}
}

/**
 * The failure for a `delete_v2` route error (DeleteError). What Dropbox
 * answers to a `parent_rev` that is not the file's latest is not
 * documented; it is taken to be a WriteError conflict, as the fake service
 * answers, until it is checked against the real service.
 */
function deleteFailure(error: Tagged): ProviderError {
	switch (error[".tag"]) {
		case "path_lookup": {
			const lookup = (error.path_lookup as Tagged | undefined)?.[".tag"];
			return new ProviderError({ category: lookup === "not_found" ? "notFound" : "permanent" }, summary(error));
		}
		case "path_write":
			return new ProviderError(writeFailure(error.path_write as Tagged | undefined), summary(error));
		case "too_many_write_operations":
			return new ProviderError({ category: "throttled", retryAfterMs: WRITE_RETRY_AFTER_MS }, summary(error));
		default:
			return routeFailure("delete_v2", error);
	}
}
