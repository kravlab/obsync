/**
 * The Dropbox Provider (spec, "Dropbox provider" and "Provider contract"):
 * one Remote, a subfolder of the App Folder, through Dropbox's HTTP API.
 *
 * - `list` is a recursive `list_folder` of the root, paged.
 * - `read` is `files/download`, `write` is `files/upload`, each one
 *   request; chunked transfers for large files come later.
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
	type Listing,
	type NameRules,
	type Precondition,
	type Provider,
	type RemoteEntry,
	type RemoteFile,
	type RemotePath,
} from "../../engine/provider";
import { DropboxClient } from "./client";
import type { DropboxOptions } from "./options";
import { WRITE_RETRY_AFTER_MS, writeFailure, type Tagged } from "./errors";
import { listFolder, lookupFailure, routeFailure, summary, writeErrorOf, type Metadata } from "./routes";

/**
 * The largest file this provider accepts: Dropbox says a single upload
 * request "should not upload more than 150 MB", read here as decimal
 * megabytes, the smaller reading.
 */
const MAX_FILE_SIZE = 150_000_000;

/**
 * Dropbox paths are case-insensitive. Its other name rules are not
 * declared yet: a name it refuses fails with `nameNotRepresentable`.
 */
const NAME_RULES: NameRules = { forbiddenCharacters: [], reservedNames: [], caseInsensitive: true };

/** The id naming Dropbox in Connections and in the login secret's id. */
export const DROPBOX_PROVIDER_ID = "dropbox";

/** Builds the connector that opens a Connection's Remote on Dropbox. */
export function createDropboxConnector({ appKey, http, clock }: DropboxOptions): ProviderConnector {
	return {
		providerId: DROPBOX_PROVIDER_ID,
		open(connection: Connection, secret: string): Promise<Provider> {
			return Promise.resolve(createDropboxProvider(new DropboxClient(http, clock, appKey, secret), connection.remoteRoot));
		},
	};
}

/** The Provider for the Remote at `root`, reached through `client`. */
export function createDropboxProvider(client: DropboxClient, root: string): Provider {
	/** The App-Folder path of a Remote path. */
	const full = (path: RemotePath): string => `${root}/${path}`;

	return {
		capabilities: { conditionalWrite: true },
		nameRules: NAME_RULES,
		maxFileSize: MAX_FILE_SIZE,

		async list(): Promise<Listing> {
			return { entries: remoteEntries(root, await listFolder(client, root, true)) };
		},

		async read(path) {
			const result = await client.download({ path: full(path) });
			if (result.ok) return result.data;
			throw lookupFailure("download", result.error);
		},

		async write(path, data, precondition): Promise<RemoteFile> {
			const result = await client.upload(
				{ path: full(path), mode: writeMode(precondition), autorename: false, strict_conflict: true },
				data,
			);
			if (!result.ok) throw uploadFailure(result.error);
			const { rev, size } = result.value as { rev: string; size: number };
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
 * The listing entries below `root`, by Remote path. `path_display` has
 * the right case only in its last component, so each path is rebuilt from
 * the entries' own `name`s along `path_lower`; the root itself, entries
 * outside it and deleted entries are left out. A file without its `rev`
 * or `size` is a response this provider cannot trust: it fails the
 * listing as `permanent`.
 */
function remoteEntries(root: string, listed: readonly Metadata[]): RemoteEntry[] {
	const rootLower = root.toLowerCase();
	const byLower = new Map(listed.map((entry) => [entry.path_lower, entry] as const));
	const paths = new Map<string, RemotePath>([[rootLower, ""]]);

	/** The Remote path of the entry at `lower`, from its ancestors' names. */
	function pathOf(lower: string, entry: Metadata): RemotePath {
		const known = paths.get(lower);
		if (known !== undefined) return known;
		const parentLower = lower.slice(0, lower.lastIndexOf("/"));
		const parent = byLower.get(parentLower);
		// A parent missing from the listing keeps its displayed name.
		const parentPath =
			parent === undefined
				? entry.path_display.slice(root.length + 1, entry.path_display.lastIndexOf("/"))
				: pathOf(parentLower, parent);
		const path = parentPath === "" ? entry.name : `${parentPath}/${entry.name}`;
		paths.set(lower, path);
		return path;
	}

	const entries: RemoteEntry[] = [];
	for (const entry of listed) {
		if (!entry.path_lower.startsWith(`${rootLower}/`) || entry[".tag"] === "deleted") continue;
		const path = pathOf(entry.path_lower, entry);
		if (entry[".tag"] === "folder") entries.push({ kind: "folder", path });
		else if (entry[".tag"] === "file") {
			if (entry.rev === undefined || entry.size === undefined) {
				throw new ProviderError({ category: "permanent" }, `list_folder: a file without rev or size: ${entry.path_lower}`);
			}
			entries.push({ kind: "file", path, revision: entry.rev, size: entry.size });
		}
	}
	return entries;
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

/** The failure for an `upload` route error. */
function uploadFailure(error: Tagged): ProviderError {
	if (error[".tag"] === "path") {
		return new ProviderError(writeFailure(error.reason as Tagged | undefined), summary(error));
	}
	if (error[".tag"] === "payload_too_large") return new ProviderError({ category: "tooLarge" }, summary(error));
	return routeFailure("upload", error);
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
