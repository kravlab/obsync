/**
 * Carrying renames (spec, "Deletions and renames"): what one sync does
 * with the renames renames.ts found, before it uploads, deletes or
 * downloads anything else.
 *
 * A rename is carried to the side that does not have it yet, then the
 * Sync snapshot entry, with its Base, moves to the new path, so the
 * content is compared there as for any synced file and an edit on either
 * side survives the rename.
 * - On the Remote a file moves with the file move Capability, else it is
 *   written at the new path and deleted at the old one on condition of
 *   the revision copied; a folder moves in one step with the folder move
 *   Capability. A copy found at the new path, from a move cut off half
 *   way, is recognised by its content, and only the old file is deleted.
 * - In the vault, `vault.rename` changes only the path, never the links
 *   in other notes; the renaming device's own link updates arrive as
 *   ordinary edits.
 * - A new path taken on the other side by another file makes this side's
 *   file a Conflict copy first: the Remote's file keeps the path. In the
 *   configuration folder this side's file is kept in the configuration
 *   conflict store instead and leaves the vault, so no copy lands there.
 *   One taken on the Remote after the listing defers the rename to the
 *   next sync, which finds it taken.
 * - Renamed differently on both sides, the vault takes the Remote's name;
 *   renamed on one side and deleted on the other, the entry is kept under
 *   its new name. The user is told of each.
 *
 * The snapshot entry keeps its revision when it moves, unless the new
 * path is known to hold the synced content under another one, so a
 * Remote edit made during the move is read, never taken for the synced
 * content.
 */
import { contentHash } from "./content-hash";
import type { LocalVault, VaultEntry, VaultFile, VaultPath } from "./local-vault";
import { comparePaths, followMoves, isWithin, movedAlong, parentOf, type Move } from "./paths";
import type { DeviceStore, UiPort } from "./ports";
import { isFailure, type Precondition, type Provider, type RemoteContent, type RemoteEntry, type RemoteFile } from "./provider";
import type { RemoteRename, Rename, RenamedOnBoth, Renames } from "./renames";
import type { SnapshotEntry, SyncedFile } from "./sync-snapshot";

/**
 * The sync under way, as carrying renames reaches it: its ports, its
 * working copies of the snapshot and both listings, which carrying
 * renames updates as it goes, and the steps it shares with the rest of
 * the sync.
 */
export interface RenameSync {
	readonly provider: Provider;
	readonly vault: LocalVault;
	readonly deviceStore: DeviceStore;
	readonly ui: UiPort;
	/** The Sync snapshot as this sync holds it. */
	readonly snapshot: Map<VaultPath, SnapshotEntry>;
	/** The Remote's entries as this sync knows them, by vault path. */
	readonly remote: Map<VaultPath, RemoteEntry>;
	/** The vault's entries as walked at the start of this sync, by path. */
	readonly walked: Map<VaultPath, VaultEntry>;
	/** Reads a Remote file; undefined when it is gone. */
	readRemote(path: VaultPath): Promise<RemoteContent | undefined>;
	/** Writes to the Remote; undefined when the precondition no longer holds. */
	writeRemote(path: VaultPath, data: ArrayBuffer, precondition: Precondition): Promise<RemoteFile | undefined>;
	/** Notes that the Remote file `path` now holds `content`, keeping its stable id. */
	setRemoteFile(path: VaultPath, content: RemoteContent): void;
	/** Creates `path` and the folders above it on the Remote where missing. */
	ensureRemoteFolder(path: VaultPath): Promise<void>;
	/** Creates `path` and the folders above it in the vault where missing. */
	ensureVaultFolder(path: VaultPath): Promise<void>;
	/**
	 * A Conflict copy name for `path` by this device now, free in the vault
	 * and on the Remote; null when the Remote can hold no copy name for it,
	 * and `path` is then skipped for this sync.
	 */
	conflictCopyPath(path: VaultPath): Promise<VaultPath | null>;
	/** Whether `path` lies in the configuration folder, where no Conflict copy is made. */
	inConfiguration(path: VaultPath): boolean;
	/** Keeps the vault file `path` as a configuration conflict's local version, and moves it to the trash. */
	keepLocalConfiguration(path: VaultPath): Promise<void>;
	/** Whether the vault file `file` still holds the content `synced` records. */
	unchangedHere(file: VaultFile, synced: SyncedFile): Promise<boolean>;
	/** Forgets `path` and its Base. */
	forget(path: VaultPath): Promise<void>;
}

/**
 * What moving a vault file out of the way did: renamed it to the Conflict
 * copy `copy`; kept a configuration file aside, out of the vault; or
 * nothing, since the Remote can hold no Conflict copy name for it.
 */
type MovedAside = { readonly kind: "copy"; readonly copy: VaultPath } | { readonly kind: "keptAside" } | { readonly kind: "noCopyName" };

/** What carrying renames leaves for the rest of the sync. */
export interface CarriedRenames {
	/** Vault files whose rename waits for the next sync: the upload pass leaves them alone. */
	readonly deferred: ReadonlySet<VaultPath>;
	/**
	 * Remote folders a refused folder move left behind, their entries
	 * carried one by one: deleted, as folders deleted here are, once a
	 * listing shows them empty.
	 */
	readonly leftRemoteFolders: readonly VaultPath[];
}

/** Carries `renames`, found for the sync `sync`, to the side each is missing from. */
export async function carryRenames(renames: Renames, sync: RenameSync): Promise<CarriedRenames> {
	const { provider, vault, deviceStore, ui, snapshot, remote, walked } = sync;
	/** Folders this sync moved, in order, in the vault and on the Remote: what was inside went along. */
	const vaultMoves: Move[] = [];
	const remoteMoves: Move[] = [];
	const leftRemoteFolders: VaultPath[] = [];
	const deferred = new Set<VaultPath>();

	/** The stable id of the Remote entry at `path`, as a snapshot entry field, if the provider gave one. */
	function stableIdAt(path: VaultPath): { readonly stableId?: string } {
		const stableId = remote.get(path)?.stableId;
		return stableId === undefined ? {} : { stableId };
	}

	/**
	 * Moves what the snapshot records for `from` to `to`, with its Base.
	 * A file keeps its revision unless `revision` is one the Remote file at
	 * `to` holds the synced content under; the stable id is the Remote
	 * entry's at `to`, if known.
	 */
	async function moveEntry(from: VaultPath, to: VaultPath, revision?: string): Promise<void> {
		const synced = snapshot.get(from);
		if (synced === undefined) return;
		const entry: SnapshotEntry =
			synced.kind === "file"
				? { ...synced, revision: revision ?? synced.revision, ...stableIdAt(to) }
				: { ...synced, ...stableIdAt(to) };
		await deviceStore.moveSnapshotEntry(from, to, entry);
		snapshot.delete(from);
		snapshot.set(to, entry);
	}

	/**
	 * Carries to the Remote the entry renamed here from `from` to `to`,
	 * then moves its snapshot entry; one inside a folder this sync moved
	 * there is already in place.
	 */
	async function carryToRemote({ kind, from, to }: Rename): Promise<void> {
		const current = followMoves(from, remoteMoves);
		if (current === to) return moveEntry(from, to);
		if (kind === "folder") return moveRemoteFolder(current, from, to);
		return moveRemoteFile(current, from, to);
	}

	/**
	 * Moves the Remote folder `current`, recorded as `from`, with
	 * everything inside it, to `to`. When the service refuses, the entries
	 * inside are carried one by one instead and the old folder is deleted
	 * once a listing shows it empty.
	 */
	async function moveRemoteFolder(current: VaultPath, from: VaultPath, to: VaultPath): Promise<void> {
		const folderMove = provider.capabilities.folderMove;
		if (folderMove === undefined) throw new Error(`engine bug: a folder move of ${from} without the Capability`);
		await sync.ensureRemoteFolder(parentOf(to));
		try {
			await folderMove.moveFolder(current, to);
		} catch (error) {
			const refused =
				isFailure(error, "preconditionFailed") || isFailure(error, "notFound") || isFailure(error, "permanent");
			if (!refused) throw error;
			await sync.ensureRemoteFolder(to);
			leftRemoteFolders.push(current);
			await moveEntry(from, to);
			return;
		}
		remoteMoves.push({ from: current, to });
		moveInside(remote, current, to);
		await moveEntry(from, to);
	}

	/**
	 * Moves the Remote file `current`, recorded as `from`, to `target`,
	 * where the vault has it now, then moves its snapshot entry. With the
	 * file move Capability it is one move; otherwise the file is written at
	 * the new path on condition that the path is free, then deleted at
	 * `current` on condition of the revision copied. The bytes copied are
	 * the vault's when both sides still hold the synced content, else the
	 * Remote's.
	 *
	 * A Remote file at `target` with the synced content, or with what
	 * `current` holds now, is this device's own copy from a move cut off
	 * half way: only the old one is deleted. Any other file there keeps the
	 * path, and the vault file becomes a Conflict copy next to it, which is
	 * carried instead; a configuration file is kept aside instead, and its
	 * old Remote file is deleted unless another device edited it. A path
	 * taken, or a file gone, since the listing
	 * defers the rename to the next sync.
	 */
	async function moveRemoteFile(current: VaultPath, from: VaultPath, target: VaultPath): Promise<void> {
		const synced = snapshot.get(from);
		const there = remote.get(current);
		if (synced?.kind !== "file" || there?.kind !== "file") return;
		let to = target;
		if (remote.has(to)) {
			if (await completeCutOffCopy(current, from, to, synced, there.revision)) return;
			const aside = await moveAsideInVault(to);
			if (aside.kind === "noCopyName") {
				deferred.add(to);
				return;
			}
			if (aside.kind === "keptAside") {
				// Kept aside, the renamed file is gone here: its old Remote file goes as a delete
				// would, only while it holds the synced content; an edit there downloads back.
				await deleteRemoteCopied(current, there.revision === synced.revision ? synced.revision : undefined);
				await sync.forget(from);
				return;
			}
			to = aside.copy;
		}
		await sync.ensureRemoteFolder(parentOf(to));
		const fileMove = provider.capabilities.fileMove;
		if (fileMove !== undefined) {
			let moved: RemoteFile;
			try {
				moved = await fileMove.moveFile(current, to);
			} catch (error) {
				if (!isFailure(error, "preconditionFailed") && !isFailure(error, "notFound")) throw error;
				deferred.add(to);
				return;
			}
			remote.delete(current);
			remote.set(to, { ...moved, path: to });
			return moveEntry(from, to);
		}
		const here = walked.get(to);
		const copied =
			there.revision === synced.revision && here?.kind === "file" && (await sync.unchangedHere(here, synced))
				? { data: await vault.read(to), revision: synced.revision }
				: await sync.readRemote(current);
		if (copied === undefined) return;
		const sameContent = (await contentHash(copied.data)) === synced.hash;
		const written = await sync.writeRemote(to, copied.data, { kind: "absent" });
		if (written === undefined) {
			deferred.add(to);
			return;
		}
		remote.set(to, written);
		await deleteRemoteCopied(current, copied.revision);
		await moveEntry(from, to, sameContent ? written.revision : undefined);
	}

	/**
	 * Whether the Remote file at `to` is this device's copy of `current`,
	 * recorded as `from` with `synced`, from a move cut off before the old
	 * file was deleted: it holds the synced content, or what `current`, at
	 * `revision` in the listing, holds now. If so the move is finished:
	 * the old file is deleted and the snapshot entry moved.
	 */
	async function completeCutOffCopy(
		current: VaultPath,
		from: VaultPath,
		to: VaultPath,
		synced: SyncedFile,
		revision: string,
	): Promise<boolean> {
		if (remote.get(to)?.kind !== "file") return false;
		const copy = await sync.readRemote(to);
		if (copy === undefined) return false;
		const copyHash = await contentHash(copy.data);
		if (copyHash === synced.hash) {
			sync.setRemoteFile(to, copy);
			await deleteRemoteCopied(current, revision === synced.revision ? synced.revision : undefined);
			await moveEntry(from, to, copy.revision);
			return true;
		}
		// A copy of the Remote's own edit: the old file still holds the same.
		const source = revision === synced.revision ? undefined : await sync.readRemote(current);
		if (source === undefined || (await contentHash(source.data)) !== copyHash) return false;
		sync.setRemoteFile(to, copy);
		await deleteRemoteCopied(current, source.revision);
		await moveEntry(from, to);
		return true;
	}

	/**
	 * Deletes the Remote file `path`, copied to its new path, on condition
	 * that it still has `revision`; without one, or when another device
	 * wrote it since, it stays, and the next sync finds it as a new file.
	 */
	async function deleteRemoteCopied(path: VaultPath, revision: string | undefined): Promise<void> {
		if (revision === undefined) return;
		try {
			await provider.delete(path, { kind: "revision", revision });
		} catch (error) {
			if (isFailure(error, "preconditionFailed")) return;
			if (!isFailure(error, "notFound")) throw error;
		}
		remote.delete(path);
	}

	/**
	 * Renames in the vault the entry renamed on the Remote, then moves its
	 * snapshot entry; one inside a folder this sync moved is already in
	 * place.
	 */
	async function carryToVault({ kind, from, to, revision }: RemoteRename): Promise<void> {
		const current = followMoves(from, vaultMoves);
		if (current === to || (await renameInVault(kind, current, to))) await moveEntry(from, to, revision);
	}

	/**
	 * Gives the vault the Remote's name for the entry renamed differently
	 * on both sides, then moves its snapshot entry and tells the user,
	 * unless a folder this sync renamed carried it.
	 */
	async function takeRemoteName({ kind, from, vaultPath, remote: renamed }: RenamedOnBoth): Promise<void> {
		const current = followMoves(vaultPath, vaultMoves);
		const carried = current === renamed.to;
		if (!carried && !(await renameInVault(kind, current, renamed.to))) return;
		await moveEntry(from, renamed.to, renamed.revision);
		if (!carried) ui.showNotice({ kind: "renamedOnBoth", path: renamed.to, localPath: vaultPath });
	}

	/**
	 * Renames the vault entry `from`, of `kind`, to `to` with
	 * `vault.rename`; returns whether it did. A new vault file at `to`
	 * becomes a Conflict copy first: the Remote's file keeps the path. An
	 * entry gone or changed in kind since the listing, or a folder in the
	 * way, is left for the next sync.
	 */
	async function renameInVault(kind: Rename["kind"], from: VaultPath, to: VaultPath): Promise<boolean> {
		if ((await vault.stat(from))?.kind !== kind) return false;
		const occupant = await vault.stat(to);
		if (occupant !== null) {
			if (occupant.kind !== "file" || kind !== "file") return false;
			if ((await moveAsideInVault(to)).kind === "noCopyName") return false;
		}
		await sync.ensureVaultFolder(parentOf(to));
		await vault.rename(from, to);
		moveInside(walked, from, to);
		if (kind === "folder") vaultMoves.push({ from, to });
		return true;
	}

	/**
	 * Renames the new vault file `path`, in the way of a file the Remote
	 * keeps there, to a Conflict copy name and tells the user; the copy is
	 * uploaded as a new file. A configuration file is kept in the
	 * configuration conflict store and leaves the vault instead,
	 * unannounced. When the Remote can hold no copy name for it, the file
	 * stays where it is, and what was to move onto its path waits.
	 */
	async function moveAsideInVault(path: VaultPath): Promise<MovedAside> {
		if (sync.inConfiguration(path)) {
			await sync.keepLocalConfiguration(path);
			walked.delete(path);
			return { kind: "keptAside" };
		}
		const copy = await sync.conflictCopyPath(path);
		if (copy === null) return { kind: "noCopyName" };
		await vault.rename(path, copy);
		moveInside(walked, path, copy);
		ui.showNotice({ kind: "conflictCopyCreated", path, copyPath: copy });
		return { kind: "copy", copy };
	}

	/**
	 * Keeps the entry renamed on one side and deleted on the other, from
	 * `deletedOn`, under its new name: forgets the old one, and the new one
	 * syncs as a new entry; the user is told unless a folder renamed with it
	 * already says so. When the side it was deleted from holds a new file at
	 * that name too, it is a rename onto an occupied path: the vault's file
	 * becomes a Conflict copy and the Remote's file takes the name. That is
	 * also what a sync cut off between carrying a rename and moving its
	 * snapshot entry leaves, which cannot be told apart from it; the copy
	 * then holds the vault's version, nothing lost.
	 */
	async function keepRenamed(
		rename: Rename,
		kept: readonly Rename[],
		deletedOn: "thisDevice" | "otherDevice",
	): Promise<void> {
		await sync.forget(rename.from);
		const taken =
			deletedOn === "thisDevice" ? (await vault.stat(rename.to))?.kind === "file" : remote.get(rename.to)?.kind === "file";
		if (rename.kind === "file" && taken) await moveAsideInVault(rename.to);
		else if (!insideRenamedFolder(rename, kept)) ui.showNotice({ kind: "renameBeatsDelete", path: rename.to, deletedOn });
	}

	for (const rename of sortedByFrom(renames.toRemote)) await carryToRemote(rename);
	for (const rename of sortedByFrom(renames.toVault)) await carryToVault(rename);
	for (const rename of sortedByFrom(renames.differentOnBoth)) await takeRemoteName(rename);
	for (const { from, to, revision } of renames.sameOnBoth) await moveEntry(from, to, revision);
	for (const rename of renames.keptHere) await keepRenamed(rename, renames.keptHere, "otherDevice");
	for (const rename of renames.keptThere) await keepRenamed(rename, renames.keptThere, "thisDevice");
	return { deferred, leftRemoteFolders };
}

/** Moves the entries of `entries` at `from` and inside it to `to`, along with their paths. */
function moveInside<T extends { readonly path: VaultPath }>(entries: Map<VaultPath, T>, from: VaultPath, to: VaultPath): void {
	for (const [path, entry] of [...entries]) {
		if (!isWithin(path, from)) continue;
		const moved = { ...entry, path: movedAlong(path, from, to) };
		entries.delete(path);
		entries.set(moved.path, moved);
	}
}

/** Whether a folder rename among `renames` took `rename` along: it lies inside at the same place. */
function insideRenamedFolder(rename: Rename, renames: readonly Rename[]): boolean {
	return renames.some(
		(folder) =>
			folder.kind === "folder" &&
			folder.from !== rename.from &&
			isWithin(rename.from, folder.from) &&
			rename.to === movedAlong(rename.from, folder.from, folder.to),
	);
}

/** `renames` ordered by the path they had, so every folder comes before what it held. */
function sortedByFrom<T extends { readonly from: VaultPath }>(renames: readonly T[]): T[] {
	return [...renames].sort((a, b) => comparePaths(a.from, b.from));
}
