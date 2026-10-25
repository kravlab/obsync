/**
 * The Dropbox Provider (spec, "Dropbox provider" and "Provider contract"):
 * one Remote, a subfolder of the App Folder, through Dropbox's HTTP API.
 *
 * - `list` is a recursive `list_folder` of the root, paged; entries are
 *   matched against the root's own `path_lower`, read once per provider
 *   with `get_metadata`, alongside its first listing.
 * - `read` is `get_metadata`, then `files/download` of that revision;
 *   `write` is `files/upload`, or an upload session for a file above the
 *   Per-request limit, which downloads also keep to (transfers.ts).
 * - `delete` is `delete_v2`.
 * - File move and folder move are `move_v2` without `autorename`, so an
 *   occupied target is refused. Dropbox's `id` is each entry's stable id:
 *   "a unique file reference that persists if files are moved or renamed".
 *   Whether a moved file keeps its `rev` is not documented; the engine
 *   does not rely on it.
 * - A file's `content_hash` is its server hash, `BLOCK_SHA256`, which the
 *   engine computes too, so a First sync recognises identical files
 *   without downloading them.
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
import {
	fileHints,
	fileRevision,
	listFolder,
	listFolderContinue,
	lookupFailure,
	routeFailure,
	stableIdOf,
	summary,
	writeErrorOf,
	type Metadata,
} from "./routes";

/**
 * The largest file this provider accepts: the most an upload session
 * takes, 2^41 - 2^22 bytes (Dropbox API spec, `upload_session/append:2`).
 */
const MAX_FILE_SIZE = 2 ** 41 - 2 ** 22;

/**
 * Dropbox's name rules. Paths are case-insensitive. The rest is not
 * verified on the live service, since Dropbox documents no list (its API
 * spec only has `WriteError.disallowed_name`):
 * - NUL, `\` and DEL, a trailing space, and segments over 255 characters,
 *   from rclone's Dropbox backend, built from observed behaviour;
 * - the reserved names `desktop.ini` and `thumbs.db`, from a third-party
 *   (QNAP) FAQ; its other names start with a dot, which never syncs.
 * A name Dropbox refuses anyway fails with `nameNotRepresentable`.
 */
const NAME_RULES: NameRules = {
	forbiddenCharacters: ["\u0000", "\\", "\u007F"],
	forbiddenAtEnd: [" "],
	reservedNames: ["desktop.ini", "thumbs.db"],
	caseInsensitive: true,
	maxSegmentLength: 255,
};

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
	/** The root's `path_lower`, read once; a failed read is not kept, so the next listing reads it again. */
	let rootLower: Promise<string> | undefined;

	/**
	 * The root's `path_lower` as Dropbox gives it (spec of the review fixes,
	 * item 12): entries are matched against Dropbox's own folding, which
	 * JavaScript's `toLowerCase` may not reproduce for every character.
	 */
	function rootKey(): Promise<string> {
		rootLower ??= (async () => {
			const found = await client.rpc("files/get_metadata", { path: root });
			if (!found.ok) throw lookupFailure("get_metadata", found.error);
			return (found.value as Metadata).path_lower;
		})().catch((error: unknown) => {
			rootLower = undefined;
			throw error;
		});
		return rootLower;
	}

	/** Moves the entry at `from` to `to` with `move_v2`, refusing an occupied `to`; returns the moved entry's metadata. */
	async function move(from: RemotePath, to: RemotePath): Promise<Metadata> {
		const result = await client.rpc("files/move_v2", { from_path: full(from), to_path: full(to), autorename: false });
		if (!result.ok) throw moveFailure(result.error);
		return (result.value as { metadata: Metadata }).metadata;
	}

	return {
		capabilities: {
			conditionalWrite: true,
			changeFeed: {
				async changes(cursor: string): Promise<ChangeBatch> {
					const [batch, lower] = await Promise.all([listFolderContinue(client, cursor), rootKey()]);
					return { changes: remoteChanges(root, lower, batch.entries, "list_folder/continue"), cursor: batch.cursor };
				},
			},
			fileMove: {
				async moveFile(from, to): Promise<RemoteFile> {
					const file = fileRevision(await move(from, to), "move_v2");
					return { kind: "file", path: to, revision: file.rev, size: file.size, ...fileHints(file) };
				},
			},
			folderMove: {
				async moveFolder(from, to): Promise<void> {
					await move(from, to);
				},
			},
		},
		nameRules: NAME_RULES,
		maxFileSize: MAX_FILE_SIZE,

		async list(): Promise<Listing> {
			// Both at once: the root's metadata is read in the time of the listing, not after it.
			const [batch, lower] = await Promise.all([listFolder(client, root, true), rootKey()]);
			return { entries: remoteEntries(root, lower, batch.entries), cursor: batch.cursor };
		},

		read(path) {
			return downloadFile(client, full(path), rules);
		},

		async write(path, data, precondition): Promise<RemoteFile> {
			const commit = { path: full(path), mode: writeMode(precondition), autorename: false, strict_conflict: true };
			const file = await uploadFile(client, commit, data, rules);
			return { kind: "file", path, revision: file.rev, size: file.size, ...fileHints(file) };
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
			if (result.ok) return { kind: "folder", path, ...stableIdOf((result.value as { metadata: Metadata }).metadata) };
			const reason = writeErrorOf(result.error);
			// An existing folder is returned as it is (Provider contract).
			const inTheWay = reason?.[".tag"] === "conflict" ? (reason.conflict as Tagged | undefined) : undefined;
			if (inTheWay?.[".tag"] !== "folder") throw new ProviderError(writeFailure(reason), summary(result.error));
			return { kind: "folder", path };
		},
	};
}

/**
 * The present entries below `root`, whose `path_lower` is `rootLower`, by
 * Remote path: the changes of a full listing with any `deleted` entries
 * left out.
 */
function remoteEntries(root: string, rootLower: string, listed: readonly Metadata[]): RemoteEntry[] {
	return remoteChanges(root, rootLower, listed, "list_folder").filter(
		(change): change is RemoteEntry => change.kind !== "deleted",
	);
}

/**
 * The changes below `root`, by Remote path, from `route`. `path_display`
 * has the right case only in its last component, so each path is rebuilt
 * from the entries' own `name`s along `path_lower`, matched against
 * `rootLower`, the root's own `path_lower`; the root itself and entries
 * outside it are left out. The changes keep Dropbox's order, a path
 * appearing as often as Dropbox reports it, since each entry is to be
 * applied in turn. A file without its `rev` or `size` is a response this
 * provider cannot trust: it fails as `permanent`.
 */
function remoteChanges(root: string, rootLower: string, listed: readonly Metadata[], route: string): Change[] {
	/** How many segments a path's split at "/" begins with for the root: "" before its leading slash, then its own. */
	const rootSegments = root.split("/").length;
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
		// A parent missing from the batch keeps its displayed name, below the root's
		// segments: the root may show in another Unicode form, of another length.
		const parentPath =
			parent === undefined
				? entry.path_display.split("/").slice(rootSegments, -1).join("/")
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
		else if (entry[".tag"] === "folder") changes.push({ kind: "folder", path, ...stableIdOf(entry) });
		else if (entry[".tag"] === "file") {
			const file = fileRevision(entry, route);
			changes.push({ kind: "file", path, revision: file.rev, size: file.size, ...fileHints(file) });
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
 * The failure for a `move_v2` route error (RelocationError): a missing
 * source is `notFound`; the target's WriteError, an occupied path
 * included, maps as for a write; no room left is `quotaExceeded`;
 * anything else, such as `too_many_files` (over 10,000 entries), is
 * permanent.
 */
function moveFailure(error: Tagged): ProviderError {
	switch (error[".tag"]) {
		case "from_lookup": {
			const lookup = (error.from_lookup as Tagged | undefined)?.[".tag"];
			return new ProviderError({ category: lookup === "not_found" ? "notFound" : "permanent" }, summary(error));
		}
		case "from_write":
		case "to":
			return new ProviderError(writeFailure(error[error[".tag"]] as Tagged | undefined), summary(error));
		case "insufficient_quota":
			return new ProviderError({ category: "quotaExceeded" }, summary(error));
		default:
			return routeFailure("move_v2", error);
	}
}

/**
 * The failure for a `delete_v2` route error (DeleteError). Dropbox does not
 * document its answer to a `parent_rev` that is not the file's latest;
 * checked against the real service on 2026-10-21, it is 409
 * `path_write/conflict/file/`, a WriteError conflict, so `preconditionFailed`.
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
