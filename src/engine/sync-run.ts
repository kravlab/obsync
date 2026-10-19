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
 *
 * Which paths take part, and their vault paths on a case-insensitive
 * provider, is settled by `syncListing` first.
 *
 * Everything else is left as it is on both sides: a file changed on both
 * to different content (text merge and Conflict copies come later), a
 * path missing on one side while S has it (deletions come later), and a
 * file and a folder at one path. An upload refused by its precondition is
 * left too; the next sync sees the other device's change.
 */
import { contentHash } from "./content-hash";
import type { LocalVault, VaultFile, VaultPath } from "./local-vault";
import { foldersDownTo, parentOf } from "./paths";
import type { DeviceStore } from "./ports";
import { isFailure, type Precondition, type Provider, type RemoteFile } from "./provider";
import { syncListing } from "./sync-listing";
import type { SnapshotEntry } from "./sync-snapshot";

/** What one sync works on. */
export interface SyncRun {
	/** The Remote, through a provider reporting conditional writes. */
	readonly provider: Provider;
	readonly vault: LocalVault;
	/** Holds the Sync snapshot. */
	readonly deviceStore: DeviceStore;
}

/**
 * Syncs once. A provider failure other than a refused precondition stops
 * the sync and is thrown; every path recorded before it stays recorded.
 */
export async function runSync({ provider, vault, deviceStore }: SyncRun): Promise<void> {
	const snapshot = new Map(await deviceStore.loadSnapshot());
	const listed = (await provider.list()).entries;
	const listing = syncListing(await vault.list(), listed, {
		configDir: vault.configDir,
		caseInsensitive: provider.nameRules.caseInsensitive,
	});
	const remote = new Map(listing.remote.map((entry) => [entry.path, entry] as const));
	const { local } = listing;
	/** Content hashes of the vault files, as read for the uploads. */
	const localHashes = new Map<VaultPath, string>();

	/** Records `entry` for `path` in the snapshot. */
	async function record(path: VaultPath, entry: SnapshotEntry): Promise<void> {
		await deviceStore.saveSnapshotEntry(path, entry);
		snapshot.set(path, entry);
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
	async function readRemote(path: VaultPath): Promise<ArrayBuffer | undefined> {
		try {
			return await provider.read(path);
		} catch (error) {
			if (isFailure(error, "notFound")) return undefined;
			throw error;
		}
	}

	/**
	 * Whether the vault file at `path` still has the content `hash`, read
	 * again just before it is overwritten: an edit made since the listing,
	 * e.g. while typing, must not be lost.
	 */
	async function stillHolds(path: VaultPath, hash: string): Promise<boolean> {
		if ((await vault.stat(path))?.kind !== "file") return false;
		return (await contentHash(await vault.read(path))) === hash;
	}

	/** Brings a vault folder to the Remote, or records it if it is there. */
	async function uploadFolder(path: VaultPath): Promise<void> {
		if (snapshot.has(path)) return;
		const there = remote.get(path);
		if (there?.kind === "file") return;
		if (there === undefined) await ensureRemoteFolder(path);
		await record(path, { kind: "folder" });
	}

	/** Uploads a vault file that is new or edited here only since the snapshot. */
	async function uploadFile(file: VaultFile): Promise<void> {
		const data = await vault.read(file.path);
		const hash = await contentHash(data);
		localHashes.set(file.path, hash);
		const synced = snapshot.get(file.path);
		const there = remote.get(file.path);
		let precondition: Precondition;
		if (synced === undefined) {
			if (there !== undefined) return;
			await ensureRemoteFolder(parentOf(file.path));
			precondition = { kind: "absent" };
		} else {
			if (synced.kind !== "file" || hash === synced.hash) return;
			if (there?.kind !== "file" || there.revision !== synced.revision) return;
			precondition = { kind: "revision", revision: synced.revision };
		}
		const written = await writeRemote(file.path, data, precondition);
		if (written === undefined) return;
		remote.set(file.path, written);
		await record(file.path, { kind: "file", revision: written.revision, hash });
	}

	/** Brings a Remote folder to the vault, or records it if it is there. */
	async function downloadFolder(path: VaultPath): Promise<void> {
		if (snapshot.has(path)) return;
		const here = await vault.stat(path);
		if (here?.kind === "file") return;
		if (here === null) await ensureVaultFolder(path);
		await record(path, { kind: "folder" });
	}

	/** Downloads a Remote file that is new or changed there only since the snapshot. */
	async function downloadFile(file: RemoteFile): Promise<void> {
		const synced = snapshot.get(file.path);
		const localHash = localHashes.get(file.path);
		if (synced !== undefined) {
			if (synced.kind !== "file" || file.revision === synced.revision) return;
			// Deleted here: left for the deletion rules.
			if (localHash === undefined) return;
			const data = await readRemote(file.path);
			if (data === undefined) return;
			const hash = await contentHash(data);
			if (localHash !== synced.hash) {
				// Edited here too: the same content, e.g. an upload cut off before
				// it was recorded, is simply recorded; other content is left for
				// the merge rules.
				if (hash === localHash) await record(file.path, { kind: "file", revision: file.revision, hash });
				return;
			}
			// A new revision with the content already synced needs no write.
			if (hash !== synced.hash) {
				if (!(await stillHolds(file.path, synced.hash))) return;
				await vault.write(file.path, data);
			}
			await record(file.path, { kind: "file", revision: file.revision, hash });
			return;
		}
		const data = await readRemote(file.path);
		if (data === undefined) return;
		const hash = await contentHash(data);
		if (localHash !== undefined) {
			// Created on both sides: the same content is simply recorded.
			if (hash === localHash) await record(file.path, { kind: "file", revision: file.revision, hash });
			return;
		}
		await ensureVaultFolder(parentOf(file.path));
		// The path may have been taken in the vault since it was listed.
		if ((await vault.stat(file.path)) !== null) return;
		await vault.write(file.path, data);
		await record(file.path, { kind: "file", revision: file.revision, hash });
	}

	for (const entry of sortedByPath(local)) {
		if (entry.kind === "folder") await uploadFolder(entry.path);
		else await uploadFile(entry);
	}
	for (const entry of sortedByPath([...remote.values()])) {
		if (entry.kind === "folder") await downloadFolder(entry.path);
		else await downloadFile(entry);
	}
}

/** `entries` ordered by path, so every folder comes before what it holds. */
function sortedByPath<T extends { readonly path: string }>(entries: readonly T[]): T[] {
	return [...entries].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
