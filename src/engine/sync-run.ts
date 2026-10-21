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
 * - L and R, no S: record them if their content is the same, proved by
 *   the provider's server hash where the plugin computes it too
 *   (server-hash.ts), else by downloading R;
 * - L, R and S: an edit on one side only is copied to the other, an
 *   upload on condition that R still has S's revision; a new revision
 *   with the same content, or edits on both sides to the same content,
 *   only update S.
 * - a text or JSON file changed on both sides to different content, or
 *   created on both without S: merged (text-merge.ts), against the Base
 *   when it is the true one, else 2-way; an upload refused by its
 *   precondition reads R again and merges the same way. The merged bytes
 *   go to both sides, then S and the Base are recorded.
 * - a file that cannot be merged so (not text, not UTF-8, or JSON whose
 *   merge wrote Conflict blocks or does not parse): L becomes a Conflict
 *   copy next to it (conflict-copy.ts), uploaded and announced, and R
 *   takes the name on both sides. No clock decides between them.
 *
 * - S with L or R gone (deletions.ts): a file deleted here and unchanged
 *   on the Remote is deleted there on condition of S's revision; a file
 *   deleted on the Remote and unchanged here goes to the user's trash. An
 *   edit beats a delete: a file deleted here but changed on the Remote
 *   comes back into the vault, one deleted there but edited here is
 *   uploaded again, each with a notice. A delete refused by its
 *   precondition is an edit made meanwhile, and brings the file back too.
 *   A folder goes after its files, and only once a listing taken then
 *   shows it empty on that side, so a file another device added meanwhile
 *   keeps it. S is forgotten once a path is gone from both sides.
 *
 * - S with L or R at another path (renames.ts): the entry was renamed. The
 *   rename is carried to the side that does not have it yet and S, with
 *   its Base, moves to the new path (carry-renames.ts); the content is then
 *   compared there as above, so an edit on either side survives the
 *   rename. Cut off half way, the next sync finds the rename again and
 *   finishes it.
 *
 * Before anything is written, the Deletion guard (deletion-guard.ts) checks
 * the files about to be deleted, and may ask the user: Apply deletes them,
 * Restore brings them back to the side they were deleted from, and a
 * closed prompt stops this sync with nothing written ("held").
 *
 * Renames run first, then uploads, then deletions, then downloads.
 *
 * A vault file typed into within the post-edit pause is not written or
 * trashed by this sync; a later one does it.
 *
 * Which paths take part, and their vault paths on a case-insensitive
 * provider, is settled by `syncListing` first; a path it leaves out is
 * never taken for a deleted one.
 *
 * Everything else is left as it is on both sides: a file and a folder at
 * one path. A merged
 * upload refused by its precondition is left too; the next sync merges
 * again.
 */
import { conflictCopyPath } from "./conflict-copy";
import { contentHash } from "./content-hash";
import { guardReason, type DeletionGuardSettings } from "./deletion-guard";
import { findDeletions } from "./deletions";
import type { LocalVault, VaultFile, VaultPath } from "./local-vault";
import { comparePaths, foldersDownTo, parentOf, pathKey } from "./paths";
import type { Clock, DeviceIdentity, DeviceStore, RemoteFeed, UiPort } from "./ports";
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
import type { DifferingOutcome, FirstSyncPreview, FirstSyncTally } from "./first-sync";
import { contentKindOf, type RemoteSettings } from "./remote-metadata";
import { serverHasher } from "./server-hash";
import { carryRenames } from "./carry-renames";
import { findRenames, type VaultRename } from "./renames";
import { syncListing } from "./sync-listing";
import type { SnapshotEntry, SyncedFile, VaultFileStat } from "./sync-snapshot";
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
	/** Tells when the post-edit pause has passed, and names Conflict copies. */
	readonly clock: Clock;
	/** Where Conflict copies are announced. */
	readonly ui: UiPort;
	/** When true, lists the Remote in full instead of using the change feed. */
	readonly reconcile: boolean;
	/** The post-edit pause in milliseconds, which holds back writes to the note being typed in. */
	readonly editPauseMs: number;
	/** This device's Deletion guard thresholds. */
	readonly guard: DeletionGuardSettings;
	/** The vault's renames since the last completed sync, in order: hints for finding renames. */
	readonly renameHints: readonly VaultRename[];
	/**
	 * Present when this is a First sync: the device has no Sync snapshot,
	 * and entries left from a First sync cut off earlier are ignored, so it
	 * only adds and merges.
	 */
	readonly firstSync?: FirstSyncRun;
}

/** What a First sync needs besides an ordinary sync. */
export interface FirstSyncRun {
	/**
	 * Called once the user started the First sync from its preview, before
	 * anything is written: the engine registers the device and marks the
	 * First sync as in progress.
	 */
	begin(): Promise<void>;
}

/**
 * Which closed prompt holds sync until the user asks for one: the Deletion
 * guard's (`deletions`) or the First sync preview (`firstSync`).
 */
export type SyncHold = "deletions" | "firstSync";

/** What a completed sync reports to the engine. */
export interface SyncRunResult {
	/**
	 * When this sync skipped writing a vault file because the user was
	 * typing in it, the milliseconds remaining until its post-edit pause ends.
	 */
	readonly nextPostEditPauseMs?: number;
	/** Set when a prompt was closed without an answer and the sync stopped before writing anything. */
	readonly held?: SyncHold;
	/** For a completed First sync, what it did. */
	readonly firstSync?: Readonly<FirstSyncTally>;
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
	ui,
	reconcile,
	editPauseMs,
	guard,
	renameHints,
	firstSync,
}: SyncRun): Promise<SyncRunResult> {
	// A First sync is a union: entries left from one cut off earlier must not turn into renames or deletions.
	const snapshot = new Map(firstSync === undefined ? await deviceStore.loadSnapshot() : []);
	const previousFeed = await deviceStore.loadRemoteFeed();
	const listed = await listRemote(provider, previousFeed, snapshot.size > 0, reconcile);
	const listing = syncListing(
		await vault.list(),
		listed.entries,
		{ configDir: vault.configDir, caseInsensitive: provider.nameRules.caseInsensitive },
		snapshot.keys(),
	);
	const remote = new Map(listing.remote.map((entry) => [entry.path, entry] as const));
	/** The vault's entries as walked at the start of this sync, by path, moved along with this sync's renames. */
	const localEntries = new Map(listing.local.map((entry) => [entry.path, entry] as const));
	/** Content hashes of the vault files, as read or taken from the snapshot for the uploads. */
	const localHashes = new Map<VaultPath, string>();
	let nextPostEditPauseMs: number | undefined;
	/**
	 * What this sync did so far, reported for a First sync only, whose
	 * Conflict copies are told in one summary instead of one by one.
	 */
	const tally: FirstSyncTally = { downloaded: 0, uploaded: 0, conflicted: 0, conflictCopies: 0 };
	/** In a First sync started with "keep Remote": every differing file gets a Conflict copy, text included. */
	let keepRemote = false;

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
	 * text or JSON in UTF-8, the files that merge. `stat` is the vault file's stat taken before it was read with
	 * that content; without one, after the engine wrote the file itself,
	 * the next sync hashes it again, so an edit saved meanwhile is found.
	 */
	async function recordFile(path: VaultPath, synced: RemoteContent, hash: string, stat?: VaultFileStat): Promise<void> {
		const { data, revision } = synced;
		const base = contentKindOf(path, settings) !== "other" && decodeUtf8(data) !== null ? data : null;
		const entry = { kind: "file", revision, hash, size: data.byteLength, ...stableIdAt(path) } as const;
		await record(path, stat === undefined ? entry : { ...entry, stat }, base);
	}

	/** The stable id of the Remote entry at `path`, as a snapshot entry field, if the provider gave one. */
	function stableIdAt(path: VaultPath): { readonly stableId?: string } {
		const stableId = remote.get(path)?.stableId;
		return stableId === undefined ? {} : { stableId };
	}

	/** The stat of the vault file at `path` as the walk at the start of this sync listed it. */
	function walkedStat(path: VaultPath): VaultFileStat | undefined {
		const file = localEntries.get(path);
		return file?.kind === "file" ? { size: file.size, mtime: file.mtime } : undefined;
	}

	/** The Base of `path` if it is the true one: the content its snapshot entry records as `hash`. */
	async function trueBase(path: VaultPath, hash: string): Promise<ArrayBuffer | null> {
		const base = await deviceStore.loadBase(path);
		return base !== null && (await contentHash(base)) === hash ? base : null;
	}

	/**
	 * Resolves the vault file at `path` changed both here and on the Remote
	 * to `remoteVersion`, unless it is being typed into. The same content
	 * on both sides is only recorded. Otherwise it is merged, against the
	 * Base when `synced` has a true one, and both sides are brought to the
	 * result: the Remote on condition that it still has `remoteVersion`,
	 * the vault if it still holds what was merged and is not being typed
	 * into. Then the result is recorded. What cannot be merged gets a
	 * Conflict copy (`keepConflictCopy`).
	 */
	async function merge(path: VaultPath, remoteVersion: RemoteContent, synced: SnapshotEntry | undefined): Promise<void> {
		if (pausedForTyping(path)) return;
		const before = await vault.stat(path);
		if (before?.kind !== "file") return;
		const localData = await vault.read(path);
		const localHash = await contentHash(localData);
		const remoteHash = await contentHash(remoteVersion.data);
		const unchanged = { size: before.size, mtime: before.mtime };
		if (remoteHash === localHash) {
			await recordFile(path, remoteVersion, localHash, unchanged);
			return;
		}
		const mergeResult = await mergedContent(path, localData, remoteVersion.data, synced);
		if (mergeResult === null) {
			await keepConflictCopy(path, localData, localHash, remoteVersion, remoteHash);
			return;
		}
		const merged = mergeResult.data;
		const hash = await contentHash(merged);
		let { revision } = remoteVersion;
		if (hash !== remoteHash) {
			const written = await writeRemote(path, merged, { kind: "revision", revision });
			if (written === undefined) return;
			remote.set(path, written);
			revision = written.revision;
		}
		if (hash !== localHash && (pausedForTyping(path) || !(await vault.replace(path, localData, merged)))) {
			return;
		}
		await recordFile(path, { data: merged, revision }, hash, hash === localHash ? unchanged : undefined);
		if (mergeResult.conflicted) tally.conflicted += 1;
	}

	/**
	 * The merge of `localData` and `remoteData`, the two versions of the
	 * file `path`, against the Base when `synced` has a true one; null when
	 * they cannot be merged: a file that is not text, a version that is not
	 * UTF-8, a JSON file whose merge wrote Conflict blocks or does not
	 * parse, or any file created on both sides in a First sync started with
	 * "keep Remote". `conflicted` tells whether it holds Conflict blocks.
	 */
	async function mergedContent(
		path: VaultPath,
		localData: ArrayBuffer,
		remoteData: ArrayBuffer,
		synced: SnapshotEntry | undefined,
	): Promise<{ readonly data: ArrayBuffer; readonly conflicted: boolean } | null> {
		const kind = contentKindOf(path, settings);
		if (kind === "other" || (keepRemote && synced === undefined)) return null;
		const base = synced?.kind === "file" ? await trueBase(path, synced.hash) : null;
		const merged = mergeText({ base, local: localData, remote: remoteData }, { local: device.name, remote: REMOTE_LABEL });
		if (merged === null) return null;
		if (kind === "json" && (merged.conflicted || !parsesAsJson(merged.data))) return null;
		return merged;
	}

	/**
	 * Keeps `localData`, this device's version of `path` with `localHash`,
	 * as a Conflict copy next to it, and puts `remoteVersion`, with
	 * `remoteHash`, under the name: no clock decides between them. The copy
	 * is written to the vault and uploaded on condition that its name is
	 * free on the Remote; a name taken there since the listing moves the
	 * vault copy to the next number and tries again, which ends since each
	 * refusal means one more entry is taken. The copy is then recorded and
	 * announced, and the vault file takes the Remote version if it still
	 * holds `localData` and is not being typed into, and is recorded. Cut
	 * off in between, the next sync finds the conflict again and makes
	 * another copy, so nothing is lost.
	 */
	async function keepConflictCopy(
		path: VaultPath,
		localData: ArrayBuffer,
		localHash: string,
		remoteVersion: RemoteContent,
		remoteHash: string,
	): Promise<void> {
		const time = clock.now();
		let copy = await freeCopyPath(path, time, 1);
		await vault.write(copy.path, localData);
		let written = await writeRemote(copy.path, localData, { kind: "absent" });
		while (written === undefined) {
			const next = await freeCopyPath(path, time, copy.number + 1);
			await vault.rename(copy.path, next.path);
			copy = next;
			written = await writeRemote(copy.path, localData, { kind: "absent" });
		}
		remote.set(copy.path, written);
		await recordFile(copy.path, { data: localData, revision: written.revision }, localHash);
		tally.conflictCopies += 1;
		if (firstSync === undefined) ui.showNotice({ kind: "conflictCopyCreated", path, copyPath: copy.path });
		if (pausedForTyping(path) || !(await vault.replace(path, localData, remoteVersion.data))) return;
		// The listing's revision is older when another device wrote `path` since: this one is now synced.
		setRemoteFile(path, remoteVersion);
		await recordFile(path, remoteVersion, remoteHash);
	}

	/**
	 * The first Conflict copy path for `path`, by this device at `time`,
	 * numbered `from` or higher, that is free in the vault and on the
	 * Remote as listed; the first copy has no number, the next ones 2, 3, ….
	 */
	async function freeCopyPath(
		path: VaultPath,
		time: number,
		from: number,
	): Promise<{ readonly path: VaultPath; readonly number: number }> {
		const { caseInsensitive } = provider.nameRules;
		const remoteKeys = new Set([...remote.keys()].map((listed) => pathKey(listed, caseInsensitive)));
		for (let number = from; ; number += 1) {
			const candidate = conflictCopyPath(path, device.name, time, number);
			if (!remoteKeys.has(pathKey(candidate, caseInsensitive)) && (await vault.stat(candidate)) === null) {
				return { path: candidate, number };
			}
		}
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
		await record(path, { kind: "folder", ...stableIdAt(path) }, null);
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
		const uploaded = await uploadOrMerge(file.path, data, hash, precondition, synced);
		if (uploaded && synced === undefined) tally.uploaded += 1;
	}

	/**
	 * Uploads `data`, the vault file `path` with `hash`, on `precondition`
	 * and records it; returns whether it did. Refused because another
	 * device wrote the file since, it is merged with what that device wrote,
	 * against `synced`.
	 */
	async function uploadOrMerge(
		path: VaultPath,
		data: ArrayBuffer,
		hash: string,
		precondition: Precondition,
		synced: SnapshotEntry | undefined,
	): Promise<boolean> {
		const written = await writeRemote(path, data, precondition);
		if (written === undefined) {
			const remoteVersion = await readRemote(path);
			if (remoteVersion !== undefined) await merge(path, remoteVersion, synced);
			return false;
		}
		remote.set(path, written);
		await recordFile(path, { data, revision: written.revision }, hash, walkedStat(path));
		return true;
	}

	/**
	 * Uploads the vault file `path`, edited here only, over the Remote's
	 * `revision`, a new revision that still holds the content `synced`
	 * records: there is nothing on the Remote to merge.
	 */
	async function uploadEditOver(path: VaultPath, revision: string, synced: SyncedFile): Promise<void> {
		const data = await vault.read(path);
		await uploadOrMerge(path, data, await contentHash(data), { kind: "revision", revision }, synced);
	}

	/** Whether the vault file `file` still holds the content `synced` records, by its stat or else its hash. */
	async function unchangedHere(file: VaultFile, synced: SyncedFile): Promise<boolean> {
		if (synced.stat?.size === file.size && synced.stat.mtime === file.mtime) return true;
		return (await contentHash(await vault.read(file.path))) === synced.hash;
	}

	/**
	 * The revision of the Remote file `path` if it holds the content `synced`
	 * records; null when its content differs or it is gone.
	 */
	async function remoteRevisionIfUnchanged(path: VaultPath, synced: SyncedFile): Promise<string | null> {
		const remoteVersion = await readRemote(path);
		if (remoteVersion === undefined) return null;
		return (await contentHash(remoteVersion.data)) === synced.hash ? remoteVersion.revision : null;
	}

	/** The snapshot's file entry for `path`, which the deletion rules found there. */
	function syncedFile(path: VaultPath): SyncedFile {
		const synced = snapshot.get(path);
		if (synced?.kind !== "file") throw new Error(`engine bug: no synced file at ${path}`);
		return synced;
	}

	/** Forgets `path`, gone from both sides now, with its Base. */
	async function forget(path: VaultPath): Promise<void> {
		await deviceStore.removeSnapshotEntry(path);
		snapshot.delete(path);
	}

	/** Forgets `path`, deleted here and now gone from the Remote too. */
	async function forgetGoneRemotely(path: VaultPath): Promise<void> {
		remote.delete(path);
		await forget(path);
	}

	/**
	 * Deletes on the Remote the file `path`, deleted here, on condition that
	 * it still has `revision`, then forgets it. Refused because another
	 * device wrote it since, it comes back (`restoreDeletedHere`); already
	 * gone there, it is only forgotten.
	 */
	async function deleteRemoteFile(path: VaultPath, revision: string): Promise<void> {
		try {
			await provider.delete(path, { kind: "revision", revision });
		} catch (error) {
			if (isFailure(error, "preconditionFailed")) return restoreDeletedHere(path);
			if (!isFailure(error, "notFound")) throw error;
		}
		await forgetGoneRemotely(path);
	}

	/**
	 * Brings back into the vault the file `path`, deleted here but edited
	 * on the Remote, and tells the user: an edit beats a delete. One gone
	 * meanwhile is forgotten; a vault path taken meanwhile is left for the
	 * next sync. Whatever the Remote holds now comes back, never deleted
	 * here: only deletions the Deletion guard counted are applied.
	 */
	async function restoreDeletedHere(path: VaultPath): Promise<void> {
		const remoteVersion = await readRemote(path);
		if (remoteVersion === undefined) return forgetGoneRemotely(path);
		if (await putBackInVault(path, remoteVersion, await contentHash(remoteVersion.data))) {
			ui.showNotice({ kind: "restoredAfterDelete", path, deletedOn: "thisDevice" });
		}
	}

	/**
	 * Brings back into the vault the file `path`, deleted here, as the
	 * Remote has it now: the Deletion guard's Restore. One gone from the
	 * Remote meanwhile is forgotten.
	 */
	async function downloadBack(path: VaultPath): Promise<void> {
		const remoteVersion = await readRemote(path);
		if (remoteVersion === undefined) return forgetGoneRemotely(path);
		await putBackInVault(path, remoteVersion, await contentHash(remoteVersion.data));
	}

	/**
	 * Writes `remoteVersion`, with `hash`, back to the vault path `path` and
	 * records it, if the path is still free; returns whether it did. A path
	 * taken meanwhile is left for the next sync.
	 */
	async function putBackInVault(path: VaultPath, remoteVersion: RemoteContent, hash: string): Promise<boolean> {
		await ensureVaultFolder(parentOf(path));
		if ((await vault.stat(path)) !== null) return false;
		await vault.write(path, remoteVersion.data);
		setRemoteFile(path, remoteVersion);
		await recordFile(path, remoteVersion, hash);
		return true;
	}

	/** Notes that the Remote file `path` now holds `content`, keeping its stable id. */
	function setRemoteFile(path: VaultPath, content: RemoteContent): void {
		const { revision, data } = content;
		remote.set(path, { kind: "file", path, revision, size: data.byteLength, ...stableIdAt(path) });
	}

	/**
	 * Moves to the user's trash the vault file `path`, deleted on the
	 * Remote, then forgets it; it is checked again just before, by its stat
	 * and only if that changed by its content, and an edit found then is
	 * kept (`keepEditedHere`). A file being typed into
	 * is left for a later sync. There is no "trash only if unchanged" in one
	 * step, so an edit saved between that check and the trash goes to the
	 * trash with the file.
	 */
	async function trashDeletedThere(path: VaultPath): Promise<void> {
		if (pausedForTyping(path)) return;
		const here = await vault.stat(path);
		if (here === null) return forget(path);
		if (here.kind !== "file") return;
		if (!(await unchangedHere(here, syncedFile(path)))) return keepEditedHere(path, true);
		await vault.trash(path);
		await forget(path);
	}

	/**
	 * Uploads again the vault file `path`, deleted on the Remote, on
	 * condition that the Remote path is still free, and records it: for a
	 * file edited here, an edit beats a delete, and `announce` tells the
	 * user; for the Deletion guard's Restore, it is not announced. A file
	 * another device put there meanwhile is merged with it, as one created
	 * on both sides.
	 */
	async function keepEditedHere(path: VaultPath, announce: boolean): Promise<void> {
		const here = await vault.stat(path);
		if (here?.kind !== "file") return;
		const data = await vault.read(path);
		const hash = await contentHash(data);
		await ensureRemoteFolder(parentOf(path));
		const written = await writeRemote(path, data, { kind: "absent" });
		if (written === undefined) {
			const remoteVersion = await readRemote(path);
			if (remoteVersion !== undefined) await merge(path, remoteVersion, undefined);
			return;
		}
		remote.set(path, written);
		await recordFile(path, { data, revision: written.revision }, hash, { size: here.size, mtime: here.mtime });
		if (announce) ui.showNotice({ kind: "restoredAfterDelete", path, deletedOn: "otherDevice" });
	}

	/**
	 * Deletes on the Remote the `folders` deleted here, deepest first, each
	 * only if a listing taken now shows nothing inside it, and forgets
	 * them. A folder another device added to meanwhile stays, and what it
	 * holds downloads. Folders have no revision, so a file added between
	 * this listing and the delete is not protected by a precondition.
	 */
	async function deleteRemoteFolders(folders: readonly VaultPath[]): Promise<void> {
		const { caseInsensitive } = provider.nameRules;
		const keyOf = (path: string): string => pathKey(path, caseInsensitive);
		// Changes since this sync's own listing where the provider has a feed, else a full listing.
		const since = listed.cursor === undefined ? null : { cursor: listed.cursor, entries: listed.entries };
		const current = await listRemote(provider, since, true, false);
		const contents = folderContents(current.entries.map((entry) => keyOf(entry.path)));
		for (const folder of deepestFirst(folders)) {
			if (!contents.isEmpty(keyOf(folder))) continue;
			try {
				await provider.delete(folder);
			} catch (error) {
				if (!isFailure(error, "notFound")) throw error;
			}
			contents.remove(keyOf(folder));
			remote.delete(folder);
			await forget(folder);
		}
	}

	/**
	 * Moves to the user's trash the vault `folders` deleted on the Remote,
	 * deepest first, each only if the vault lists nothing inside it now and
	 * the Remote did not get it back from this sync's uploads, and forgets
	 * them. A folder holding a new file stays; the file's upload brought
	 * the folder back to the Remote.
	 */
	async function trashVaultFolders(folders: readonly VaultPath[]): Promise<void> {
		const contents = folderContents((await vault.list()).map((entry) => entry.path));
		for (const folder of deepestFirst(folders)) {
			if (remote.has(folder) || !contents.isEmpty(folder)) continue;
			if (contents.has(folder)) await vault.trash(folder);
			contents.remove(folder);
			await forget(folder);
		}
	}

	/** Brings a Remote folder to the vault, or records it if it is there. */
	async function downloadFolder(path: VaultPath): Promise<void> {
		if (snapshot.has(path)) return;
		const here = await vault.stat(path);
		if (here?.kind === "file") return;
		if (here === null) await ensureVaultFolder(path);
		await record(path, { kind: "folder", ...stableIdAt(path) }, null);
	}

	/**
	 * Records the vault file at `file`'s path, with no snapshot entry, as
	 * synced at `file`'s revision when `file` carries a server hash the
	 * plugin computes itself and the vault file has the same one; returns
	 * whether it did. The vault's bytes are the Base, so nothing downloads.
	 */
	async function recordIfSameByServerHash(file: RemoteFile): Promise<boolean> {
		if (file.serverHash === undefined || (await vault.stat(file.path))?.kind !== "file") return false;
		const data = await vault.read(file.path);
		if ((await sameByServerHash(data, file)) !== true) return false;
		await recordFile(file.path, { data, revision: file.revision }, await contentHash(data));
		return true;
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
				// it was recorded, is simply recorded; the synced content under a
				// new revision, e.g. after a move, takes the edit; other content is merged.
				if (hash === localHash) await recordFile(file.path, remoteVersion, hash, walkedStat(file.path));
				else if (hash === synced.hash) await uploadEditOver(file.path, remoteVersion.revision, synced);
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
		// Created on both sides with content the provider's hash proves the same: no download.
		if (localHash !== undefined && (await recordIfSameByServerHash(file))) return;
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
		tally.downloaded += 1;
	}

	/**
	 * What a First sync would do, as its preview shows it, from this sync's
	 * listings; files on both sides are compared by content, through the
	 * provider's server hash where the plugin computes it, else by reading
	 * the Remote file. Nothing is written.
	 */
	async function firstSyncPreview(): Promise<FirstSyncPreview> {
		const toDownload: VaultPath[] = [];
		const toUpload: VaultPath[] = [];
		const identical: VaultPath[] = [];
		const differing: { path: VaultPath; outcome: DifferingOutcome }[] = [];
		for (const entry of sortedByPath([...localEntries.values()])) {
			if (entry.kind !== "file") continue;
			const there = remote.get(entry.path);
			if (there === undefined) toUpload.push(entry.path);
			else if (there.kind !== "file") continue;
			else if (await sameContent(entry.path, there)) identical.push(entry.path);
			else differing.push({ path: entry.path, outcome: contentKindOf(entry.path, settings) === "text" ? "merged" : "conflictCopy" });
		}
		for (const entry of sortedByPath([...remote.values()])) {
			if (entry.kind === "file" && !localEntries.has(entry.path)) toDownload.push(entry.path);
		}
		return { toDownload, toUpload, identical, differing };
	}

	/** Whether the vault file `path` holds what the Remote file `there` does. */
	async function sameContent(path: VaultPath, there: RemoteFile): Promise<boolean> {
		const data = await vault.read(path);
		const byServerHash = await sameByServerHash(data, there);
		if (byServerHash !== undefined) return byServerHash;
		const theirs = await readRemote(path);
		return theirs !== undefined && (await contentHash(theirs.data)) === (await contentHash(data));
	}

	if (firstSync !== undefined) {
		const answer = await ui.askFirstSync(await firstSyncPreview());
		if (answer === null) return { held: "firstSync" };
		keepRemote = answer.differing === "keepRemote";
		await firstSync.begin();
	}
	const renames = await findRenames(
		snapshot,
		listing,
		renameHints,
		{
			localHash: async (path) => contentHash(await vault.read(path)),
			async remoteContent(path) {
				const content = await readRemote(path);
				return content === undefined ? null : { hash: await contentHash(content.data), revision: content.revision };
			},
		},
		{ caseInsensitive: provider.nameRules.caseInsensitive, folderMove: provider.capabilities.folderMove !== undefined },
	);
	const unrenamed = new Map([...snapshot].filter(([path]) => !renames.paths.has(path)));
	const deletions = await findDeletions(unrenamed, listing, { unchangedHere, remoteRevisionIfUnchanged });
	/** Vault files the deletion rules handle instead of the upload pass. */
	const deletedThere = new Set([...deletions.toVault, ...deletions.localChanged]);
	const syncedPaths = [...snapshot].filter(([, entry]) => entry.kind === "file").map(([path]) => path);
	const toRemotePaths = deletions.toRemote.map(({ path }) => path);
	// A renamed file is still there, under its new name.
	const renamedHere = new Set([...renames.toRemote, ...renames.sameOnBoth, ...renames.keptHere].map(({ from }) => from));
	const renamedThere = new Set([...renames.toVault, ...renames.sameOnBoth, ...renames.keptThere].map(({ from }) => from));
	for (const { from } of renames.differentOnBoth) {
		renamedHere.add(from);
		renamedThere.add(from);
	}
	const reason = guardReason(
		{
			syncedFiles: syncedPaths.length,
			vaultFiles: syncedPaths.filter((path) => renamedHere.has(path) || !listing.goneLocally(path)).length,
			remoteFiles: syncedPaths.filter((path) => renamedThere.has(path) || !listing.goneRemotely(path)).length,
			toRemote: toRemotePaths.length,
			toVault: deletions.toVault.length,
		},
		guard,
	);
	const answer =
		reason === null
			? "apply"
			: await ui.askDeletions({ reason, toRemote: toRemotePaths, toVault: deletions.toVault });
	if (answer === null) return { held: "deletions" };

	const { deferred, leftRemoteFolders } = await carryRenames(renames, {
		provider,
		vault,
		deviceStore,
		ui,
		snapshot,
		remote,
		walked: localEntries,
		readRemote,
		writeRemote,
		setRemoteFile,
		ensureRemoteFolder,
		ensureVaultFolder,
		conflictCopyPath: async (path) => (await freeCopyPath(path, clock.now(), 1)).path,
		unchangedHere,
		forget,
	});
	const localFiles = [...localEntries.values()].filter((entry): entry is VaultFile => entry.kind === "file");
	for (const file of sortedForUpload(localFiles, settings)) {
		if (!deletedThere.has(file.path) && !deferred.has(file.path)) await uploadFile(file);
	}
	for (const entry of sortedByPath([...localEntries.values()])) {
		if (entry.kind === "folder") await uploadFolder(entry.path);
	}
	for (const path of deletions.forgotten) await forget(path);
	for (const path of deletions.remoteChanged) await restoreDeletedHere(path);
	for (const path of deletions.localChanged) await keepEditedHere(path, true);
	if (answer === "apply") {
		for (const { path, revision } of deletions.toRemote) await deleteRemoteFile(path, revision);
		for (const path of deletions.toVault) await trashDeletedThere(path);
		if (deletions.foldersToRemote.length > 0) await deleteRemoteFolders(deletions.foldersToRemote);
		if (deletions.foldersToVault.length > 0) await trashVaultFolders(deletions.foldersToVault);
	} else {
		// Restore: each deleted file and folder goes back to the side it was deleted from.
		for (const path of toRemotePaths) await downloadBack(path);
		for (const path of deletions.toVault) await keepEditedHere(path, false);
		for (const path of deletions.foldersToRemote) await ensureVaultFolder(path);
		for (const path of deletions.foldersToVault) await ensureRemoteFolder(path);
	}
	if (leftRemoteFolders.length > 0) await deleteRemoteFolders(leftRemoteFolders);
	for (const entry of sortedByPath([...remote.values()])) {
		if (entry.kind === "folder") await downloadFolder(entry.path);
		else await downloadFile(entry);
	}
	// A cursor that did not move brought no change: the stored state is still right.
	if (listed.cursor !== undefined && listed.cursor !== previousFeed?.cursor) {
		await deviceStore.saveRemoteFeed({ cursor: listed.cursor, entries: listed.entries });
	}
	return firstSync === undefined ? { nextPostEditPauseMs } : { nextPostEditPauseMs, firstSync: tally };
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

/** Which of a listing's paths exist and how many entries each folder holds directly. */
interface FolderContents {
	/** Whether the listing has `path`. */
	has(path: string): boolean;
	/** Whether the folder `path` holds nothing, as listed and after what `remove` took away. */
	isEmpty(path: string): boolean;
	/** Takes `path` out of the listing, so its parent may become empty; a path not listed changes nothing. */
	remove(path: string): void;
}

/** The contents of the folders in a listing of `paths`, counted once so each check is a lookup. */
function folderContents(paths: readonly string[]): FolderContents {
	const present = new Set(paths);
	const counts = new Map<string, number>();
	for (const path of present) counts.set(parentOf(path), (counts.get(parentOf(path)) ?? 0) + 1);
	return {
		has: (path) => present.has(path),
		isEmpty: (path) => (counts.get(path) ?? 0) === 0,
		remove(path) {
			if (!present.delete(path)) return;
			counts.set(parentOf(path), (counts.get(parentOf(path)) ?? 1) - 1);
		},
	};
}

/** `folders` ordered so every folder comes after the folders inside it. */
function deepestFirst(folders: readonly VaultPath[]): VaultPath[] {
	return sortedByPath(folders.map((path) => ({ path })))
		.reverse()
		.map(({ path }) => path);
}

/**
 * Whether `data` is what `there` holds, by `there`'s server hash; undefined
 * when it carries none the plugin computes itself.
 */
async function sameByServerHash(data: ArrayBuffer, there: RemoteFile): Promise<boolean | undefined> {
	const hasher = there.serverHash === undefined ? null : serverHasher(there.serverHash.algorithm);
	if (hasher === null) return undefined;
	return (await hasher(data)) === there.serverHash?.value;
}

/** `entries` ordered by path, so every folder comes before what it holds. */
function sortedByPath<T extends { readonly path: string }>(entries: readonly T[]): T[] {
	return [...entries].sort((a, b) => comparePaths(a.path, b.path));
}

/** Whether `data` is UTF-8 text that parses as JSON. */
function parsesAsJson(data: ArrayBuffer): boolean {
	const decoded = decodeUtf8(data);
	if (decoded === null) return false;
	try {
		JSON.parse(decoded);
		return true;
	} catch {
		return false;
	}
}
