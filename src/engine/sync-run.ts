/**
 * One sync of this device's vault with its Remote (spec, "Remote layout
 * and change detection", "Concurrency and the no-loss guarantee"). It
 * lists both sides, compares them with the Sync snapshot, uploads first,
 * then downloads, and records each path in the snapshot only once both
 * sides hold the same content. Nothing else is persisted, so a sync cut
 * off at any point re-derives its remaining work next time.
 *
 * What a sync does per path, with the snapshot entry S, the vault file L
 * and the Remote file R:
 * - only L, no S: upload it on condition that R is absent;
 * - only R, no S: download it, if the vault path is still free;
 * - L and R, no S: record them if their content is the same;
 * - L, R and S: an edit on one side only is copied to the other, an
 *   upload on condition that R still has S's revision; a new revision
 *   with the same content, or edits on both sides to the same content,
 *   only update S.
 * - a text file changed on both sides to different content, or created on
 *   both without S: merged (text-merge.ts), against the Base when it is
 *   the true one, else 2-way; an upload refused by its precondition reads
 *   R again and merges the same way. The merged bytes go to both sides,
 *   then S and the Base are recorded.
 *
 * A vault file typed into within the post-edit pause is not written by this
 * sync; a later one writes it.
 *
 * Which paths take part, and their vault paths on a case-insensitive
 * provider, is settled by `syncListing` first.
 *
 * Everything else is left as it is on both sides: a file that is not
 * text changed on both to different content (Conflict copies come later),
 * a path missing on one side while S has it (deletions come later), and a
 * file and a folder at one path. A merged upload refused by its
 * precondition is left too; the next sync merges again.
 */
import { contentHash } from "./content-hash";
import type { LocalVault, VaultFile, VaultPath } from "./local-vault";
import { comparePaths, foldersDownTo, parentOf, pathKey } from "./paths";
import type { Clock, DeviceIdentity, DeviceStore, RemoteFeed } from "./ports";
import {
	isFailure,
	type Change,
	type Listing,
	type Precondition,
	type Provider,
	type RemoteContent,
	type RemoteEntry,
	type RemoteFile,
} from "./provider";
import { contentKindOf, type RemoteSettings } from "./remote-metadata";
import { syncListing } from "./sync-listing";
import type { SnapshotEntry, VaultFileStat } from "./sync-snapshot";
import { mergeText } from "./text-merge";
import { postEditPauseRemainingMs } from "./post-edit-pause";
import { decodeUtf8 } from "./utf8";

/**
 * The second label of every Conflict block: without Device journals the
 * device that wrote the Remote version is never known.
 */
const REMOTE_LABEL = "Remote";

/** What one sync works on. */
export interface SyncRun {
	/** The Remote, through a provider reporting conditional writes. */
	readonly provider: Provider;
	readonly vault: LocalVault;
	/** Holds the Sync snapshot, the Bases and the Remote feed state. */
	readonly deviceStore: DeviceStore;
	/** The shared Remote settings, read at the start of this sync. */
	readonly settings: RemoteSettings;
	/** This device, whose name labels its side of a Conflict block. */
	readonly device: DeviceIdentity;
	/** Tells when the post-edit pause has passed. */
	readonly clock: Clock;
	/** When true, lists the Remote in full instead of using the change feed. */
	readonly reconcile: boolean;
	/** The post-edit pause in milliseconds, which holds back writes to the note being typed in. */
	readonly editPauseMs: number;
}

/** What a completed sync reports to the engine. */
export interface SyncRunResult {
	/**
	 * When this sync skipped writing a vault file because the user was
	 * typing in it, the milliseconds remaining until its post-edit pause ends.
	 */
	readonly nextPostEditPauseMs?: number;
}

/**
 * Syncs once. A provider failure other than a refused precondition stops
 * the sync and is thrown; every path recorded before it stays recorded.
 */
export async function runSync({
	provider,
	vault,
	deviceStore,
	settings,
	device,
	clock,
	reconcile,
	editPauseMs,
}: SyncRun): Promise<SyncRunResult> {
	const snapshot = new Map(await deviceStore.loadSnapshot());
	const previousFeed = await deviceStore.loadRemoteFeed();
	const listed = await listRemote(provider, previousFeed, snapshot.size > 0, reconcile);
	const listing = syncListing(await vault.list(), listed.entries, {
		configDir: vault.configDir,
		caseInsensitive: provider.nameRules.caseInsensitive,
	});
	const remote = new Map(listing.remote.map((entry) => [entry.path, entry] as const));
	const { local } = listing;
	/** The vault files of the walk at the start of this sync, by path. */
	const localFiles = new Map(
		local.filter((entry): entry is VaultFile => entry.kind === "file").map((file) => [file.path, file] as const),
	);
	/** Content hashes of the vault files, as read or taken from the snapshot for the uploads. */
	const localHashes = new Map<VaultPath, string>();
	let nextPostEditPauseMs: number | undefined;

	/** Whether `path` is within the post-edit pause; remembers the earliest pause end. */
	function pausedForTyping(path: VaultPath): boolean {
		const remaining = postEditPauseRemainingMs(vault, clock, path, editPauseMs);
		if (remaining <= 0) return false;
		nextPostEditPauseMs = nextPostEditPauseMs === undefined ? remaining : Math.min(nextPostEditPauseMs, remaining);
		return true;
	}

	/** Records `entry` for `path` in the snapshot, with `base` as its Base. */
	async function record(path: VaultPath, entry: SnapshotEntry, base: ArrayBuffer | null): Promise<void> {
		await deviceStore.saveSnapshotEntry(path, entry, base);
		snapshot.set(path, entry);
	}

	/**
	 * Records the file `path`, now `synced.data` with `hash` on both sides
	 * and `synced.revision` on the Remote; the data is its Base if it is
	 * text. `stat` is the vault file's stat taken before it was read with
	 * that content; without one, after the engine wrote the file itself,
	 * the next sync hashes it again, so an edit saved meanwhile is found.
	 */
	async function recordFile(path: VaultPath, synced: RemoteContent, hash: string, stat?: VaultFileStat): Promise<void> {
		const { data, revision } = synced;
		const base = contentKindOf(path, settings) === "text" && decodeUtf8(data) !== null ? data : null;
		await record(path, { kind: "file", revision, hash, ...(stat === undefined ? {} : { stat }) }, base);
	}

	/** The stat of the vault file at `path` as the walk at the start of this sync listed it. */
	function walkedStat(path: VaultPath): VaultFileStat | undefined {
		const file = localFiles.get(path);
		return file === undefined ? undefined : { size: file.size, mtime: file.mtime };
	}

	/** The Base of `path` if it is the true one: the content its snapshot entry records as `hash`. */
	async function trueBase(path: VaultPath, hash: string): Promise<ArrayBuffer | null> {
		const base = await deviceStore.loadBase(path);
		return base !== null && (await contentHash(base)) === hash ? base : null;
	}

	/**
	 * Merges the vault file at `path` with `remoteVersion`, against the
	 * Base when `synced` has a true one, and brings both sides to the
	 * result: the Remote on condition that it still has `remoteVersion`, the vault
	 * if it still holds what was merged and is not being typed into. Then
	 * records the result. Anything that is not text is left alone.
	 */
	async function merge(path: VaultPath, remoteVersion: RemoteContent, synced: SnapshotEntry | undefined): Promise<void> {
		if (contentKindOf(path, settings) !== "text" || pausedForTyping(path)) return;
		const before = await vault.stat(path);
		if (before?.kind !== "file") return;
		const localData = await vault.read(path);
		const localHash = await contentHash(localData);
		const base = synced?.kind === "file" ? await trueBase(path, synced.hash) : null;
		const merged = mergeText({ base, local: localData, remote: remoteVersion.data }, { local: device.name, remote: REMOTE_LABEL });
		if (merged === null) return;
		const hash = await contentHash(merged);
		let { revision } = remoteVersion;
		if (hash !== (await contentHash(remoteVersion.data))) {
			const written = await writeRemote(path, merged, { kind: "revision", revision });
			if (written === undefined) return;
			remote.set(path, written);
			revision = written.revision;
		}
		if (hash !== localHash && (pausedForTyping(path) || !(await vault.replace(path, localData, merged)))) {
			return;
		}
		const unwritten = hash === localHash ? { size: before.size, mtime: before.mtime } : undefined;
		await recordFile(path, { data: merged, revision }, hash, unwritten);
	}

	/** Creates `path` and the folders above it on the Remote where missing. */
	async function ensureRemoteFolder(path: VaultPath): Promise<void> {
		for (const folder of foldersDownTo(path)) {
			if (remote.has(folder)) continue;
			remote.set(folder, await provider.createFolder(folder));
		}
	}

	/** Creates `path` and the folders above it in the vault where missing. */
	async function ensureVaultFolder(path: VaultPath): Promise<void> {
		for (const folder of foldersDownTo(path)) {
			if ((await vault.stat(folder)) === null) await vault.createFolder(folder);
		}
	}

	/** Writes to the Remote; undefined when the precondition no longer holds. */
	async function writeRemote(
		path: VaultPath,
		data: ArrayBuffer,
		precondition: Precondition,
	): Promise<RemoteFile | undefined> {
		try {
			return await provider.write(path, data, precondition);
		} catch (error) {
			if (isFailure(error, "preconditionFailed")) return undefined;
			throw error;
		}
	}

	/** Reads a Remote file; undefined when it is gone since the listing. */
	async function readRemote(path: VaultPath): Promise<RemoteContent | undefined> {
		try {
			return await provider.read(path);
		} catch (error) {
			if (isFailure(error, "notFound")) return undefined;
			throw error;
		}
	}

	/**
	 * Replaces the vault file at `path` with `data` if it still has the
	 * content `hash`, read again just before and kept while it is
	 * overwritten: an edit made since the listing, e.g. while typing, must
	 * not be lost. Returns whether it did.
	 */
	async function replaceIfStill(path: VaultPath, hash: string, data: ArrayBuffer): Promise<boolean> {
		if ((await vault.stat(path))?.kind !== "file") return false;
		const current = await vault.read(path);
		if ((await contentHash(current)) !== hash) return false;
		return vault.replace(path, current, data);
	}

	/** Brings a vault folder to the Remote, or records it if it is there. */
	async function uploadFolder(path: VaultPath): Promise<void> {
		if (snapshot.has(path)) return;
		const there = remote.get(path);
		if (there?.kind === "file") return;
		if (there === undefined) await ensureRemoteFolder(path);
		await record(path, { kind: "folder" }, null);
	}

	/** Uploads a vault file that is new or edited here only since the snapshot. */
	async function uploadFile(file: VaultFile): Promise<void> {
		const synced = snapshot.get(file.path);
		const there = remote.get(file.path);
		if (synced?.kind === "file" && synced.stat?.size === file.size && synced.stat.mtime === file.mtime) {
			localHashes.set(file.path, synced.hash);
			return;
		}
		const data = await vault.read(file.path);
		const hash = await contentHash(data);
		localHashes.set(file.path, hash);
		let precondition: Precondition;
		if (synced === undefined) {
			if (there !== undefined) return;
			await ensureRemoteFolder(parentOf(file.path));
			precondition = { kind: "absent" };
		} else {
			if (synced.kind !== "file") return;
			if (hash === synced.hash) {
				if (there?.kind === "file" && there.revision === synced.revision) {
					await recordFile(file.path, { data, revision: synced.revision }, hash, walkedStat(file.path));
				}
				return;
			}
			if (there?.kind !== "file" || there.revision !== synced.revision) return;
			precondition = { kind: "revision", revision: synced.revision };
		}
		const written = await writeRemote(file.path, data, precondition);
		if (written === undefined) {
			// Another device wrote the file since the listing: merge with what it wrote.
			const remoteVersion = await readRemote(file.path);
			if (remoteVersion !== undefined) await merge(file.path, remoteVersion, synced);
			return;
		}
		remote.set(file.path, written);
		await recordFile(file.path, { data, revision: written.revision }, hash, walkedStat(file.path));
	}

	/** Brings a Remote folder to the vault, or records it if it is there. */
	async function downloadFolder(path: VaultPath): Promise<void> {
		if (snapshot.has(path)) return;
		const here = await vault.stat(path);
		if (here?.kind === "file") return;
		if (here === null) await ensureVaultFolder(path);
		await record(path, { kind: "folder" }, null);
	}

	/**
	 * Downloads a Remote file that is new or changed there only since the
	 * snapshot, or merges it with the vault file where both changed.
	 */
	async function downloadFile(file: RemoteFile): Promise<void> {
		const synced = snapshot.get(file.path);
		const localHash = localHashes.get(file.path);
		if (synced !== undefined) {
			if (synced.kind !== "file" || file.revision === synced.revision) return;
			// Deleted here: left for the deletion rules.
			if (localHash === undefined) return;
			const remoteVersion = await readRemote(file.path);
			if (remoteVersion === undefined) return;
			const hash = await contentHash(remoteVersion.data);
			if (localHash !== synced.hash) {
				// Edited here too: the same content, e.g. an upload cut off before
				// it was recorded, is simply recorded; other content is merged.
				if (hash === localHash) await recordFile(file.path, remoteVersion, hash, walkedStat(file.path));
				else await merge(file.path, remoteVersion, synced);
				return;
			}
			// A new revision with the content already synced needs no write.
			if (hash === synced.hash) {
				await recordFile(file.path, remoteVersion, hash, walkedStat(file.path));
				return;
			}
			if (pausedForTyping(file.path)) return;
			if (!(await replaceIfStill(file.path, synced.hash, remoteVersion.data))) {
				// The vault file changed after all, e.g. an edit its size and mtime did not show: merge it.
				await merge(file.path, remoteVersion, synced);
				return;
			}
			await recordFile(file.path, remoteVersion, hash);
			return;
		}
		const remoteVersion = await readRemote(file.path);
		if (remoteVersion === undefined) return;
		const hash = await contentHash(remoteVersion.data);
		if (localHash !== undefined) {
			// Created on both sides: the same content is simply recorded, other content merged.
			if (hash === localHash) await recordFile(file.path, remoteVersion, hash, walkedStat(file.path));
			else await merge(file.path, remoteVersion, undefined);
			return;
		}
		await ensureVaultFolder(parentOf(file.path));
		// The path may have been taken in the vault since it was listed.
		if ((await vault.stat(file.path)) !== null) return;
		await vault.write(file.path, remoteVersion.data);
		await recordFile(file.path, remoteVersion, hash);
	}

	for (const file of sortedForUpload([...localFiles.values()], settings)) {
		await uploadFile(file);
	}
	for (const entry of sortedByPath(local)) {
		if (entry.kind === "folder") await uploadFolder(entry.path);
	}
	for (const entry of sortedByPath([...remote.values()])) {
		if (entry.kind === "folder") await downloadFolder(entry.path);
		else await downloadFile(entry);
	}
	// A cursor that did not move brought no change: the stored state is still right.
	if (listed.cursor !== undefined && listed.cursor !== previousFeed?.cursor) {
		await deviceStore.saveRemoteFeed({ cursor: listed.cursor, entries: listed.entries });
	}
	return { nextPostEditPauseMs };
}

/**
 * The Remote's entries at the start of a sync, from the change feed when
 * the provider offers it and `previous`, the stored feed state, exists
 * after the first sync, or from a full listing on first sync,
 * `reconcile`, or `cursorLost`. A full listing whose cursor was reset
 * while paging is tried once more.
 */
async function listRemote(
	provider: Provider,
	previous: RemoteFeed | null,
	hasSnapshot: boolean,
	reconcile: boolean,
): Promise<Listing> {
	const feed = provider.capabilities.changeFeed;
	if (feed !== undefined && hasSnapshot && !reconcile) {
		if (previous !== null) {
			try {
				const batch = await feed.changes(previous.cursor);
				return {
					entries: applyChanges(previous.entries, batch.changes, provider.nameRules.caseInsensitive),
					cursor: batch.cursor,
				};
			} catch (error) {
				if (!isFailure(error, "cursorLost")) throw error;
			}
		}
	}
	try {
		return await provider.list();
	} catch (error) {
		if (!isFailure(error, "cursorLost")) throw error;
		return provider.list();
	}
}

/**
 * Applies a change-feed batch, in order, to the Remote's previous listing,
 * matching paths without case on a case-insensitive service. A deleted
 * entry and a file both end what was at their path, folder contents
 * included, as Dropbox says of a file replacing a folder: "remove all its
 * children".
 */
function applyChanges(
	previous: readonly RemoteEntry[],
	changes: readonly Change[],
	caseInsensitive: boolean,
): RemoteEntry[] {
	const keyOf = (path: string): string => pathKey(path, caseInsensitive);
	const byKey = new Map<string, RemoteEntry>();
	for (const entry of previous) byKey.set(keyOf(entry.path), entry);
	for (const change of changes) {
		const key = keyOf(change.path);
		if (change.kind !== "folder") {
			const prefix = `${key}/`;
			for (const existing of [...byKey.keys()]) {
				if (existing === key || existing.startsWith(prefix)) byKey.delete(existing);
			}
		}
		if (change.kind !== "deleted") byKey.set(key, change);
	}
	return [...byKey.values()];
}

/**
 * Vault files in upload order: text files before attachments, smaller
 * files before larger ones, then by path.
 */
function sortedForUpload(files: readonly VaultFile[], settings: RemoteSettings): VaultFile[] {
	return [...files].sort((a, b) => {
		const aText = contentKindOf(a.path, settings) === "text" ? 0 : 1;
		const bText = contentKindOf(b.path, settings) === "text" ? 0 : 1;
		if (aText !== bText) return aText - bText;
		if (a.size !== b.size) return a.size - b.size;
		return comparePaths(a.path, b.path);
	});
}

/** `entries` ordered by path, so every folder comes before what it holds. */
function sortedByPath<T extends { readonly path: string }>(entries: readonly T[]): T[] {
	return [...entries].sort((a, b) => comparePaths(a.path, b.path));
}
