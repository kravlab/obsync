/**
 * Finding deletions (spec, "Deletions and renames"): a path the Sync
 * snapshot records that one side no longer has was deleted there. There
 * are no tombstones on the Remote; the snapshot alone tells "deleted
 * elsewhere" from "never synced here". A path a side's listing left out
 * (`syncListing`) is not gone, so it is never taken for a deleted one.
 *
 * An edit beats a delete: a file deleted on one side but changed on the
 * other since the snapshot is not a deletion but a file to bring back.
 */
import type { VaultFile, VaultPath } from "./local-vault";
import type { SyncListing } from "./sync-listing";
import type { SyncedFile, SyncSnapshot } from "./sync-snapshot";

/** A file to delete on the Remote, on condition that it still has `revision`. */
interface RemoteDeletion {
	readonly path: VaultPath;
	/** The revision the Remote holds with the content the snapshot records. */
	readonly revision: string;
}

/** What finding deletions needs to look at besides the listings. */
export interface DeletionChecks {
	/** Whether the vault file `file` still holds the content `synced` records. */
	unchangedHere(file: VaultFile, synced: SyncedFile): Promise<boolean>;
	/**
	 * The revision of the Remote file `path` if it still holds the content
	 * `synced` records under a new revision; null when its content differs
	 * or it is gone.
	 */
	remoteRevisionIfUnchanged(path: VaultPath, synced: SyncedFile): Promise<string | null>;
}

/** What one sync does about the snapshot's paths that a side no longer has. */
export interface Deletions {
	/**
	 * Files deleted here whose content on the Remote is still the synced
	 * one, under the snapshot's revision or a new one: deleted there.
	 */
	readonly toRemote: readonly RemoteDeletion[];
	/** Files deleted here but edited on the Remote since the snapshot: brought back. */
	readonly remoteChanged: readonly VaultPath[];
	/** Files deleted on the Remote and unchanged here since the snapshot: trashed. */
	readonly toVault: readonly VaultPath[];
	/** Files deleted on the Remote but edited here: uploaded again. */
	readonly localChanged: readonly VaultPath[];
	/**
	 * Folders deleted here that the Remote still has: deleted there after
	 * the files, only once a listing shows them empty.
	 */
	readonly foldersToRemote: readonly VaultPath[];
	/**
	 * Folders deleted on the Remote that the vault still has: trashed after
	 * the files, only once the vault shows them empty.
	 */
	readonly foldersToVault: readonly VaultPath[];
	/** Paths gone from both sides: only forgotten. */
	readonly forgotten: readonly VaultPath[];
}

/**
 * Sorts the paths of `snapshot` that a side of `listing` no longer has,
 * comparing content through `checks`: a new Remote revision is read, so a
 * file whose content is unchanged there counts as a deletion, which the
 * Deletion guard sees. A file or folder deleted on one side counts
 * only when the other side's listing holds the same kind of entry at its
 * path; anything else there (another kind now, or a path left out) is
 * left as it is.
 */
export async function findDeletions(snapshot: SyncSnapshot, listing: SyncListing, checks: DeletionChecks): Promise<Deletions> {
	const localFiles = new Map(
		listing.local.filter((entry): entry is VaultFile => entry.kind === "file").map((file) => [file.path, file] as const),
	);
	const remote = new Map(listing.remote.map((entry) => [entry.path, entry] as const));
	const toRemote: RemoteDeletion[] = [];
	const remoteChanged: VaultPath[] = [];
	const toVault: VaultPath[] = [];
	const localChanged: VaultPath[] = [];
	const foldersToRemote: VaultPath[] = [];
	const foldersToVault: VaultPath[] = [];
	const forgotten: VaultPath[] = [];
	const localFolders = new Set(listing.local.filter((entry) => entry.kind === "folder").map((entry) => entry.path));
	for (const [path, synced] of snapshot) {
		const goneHere = listing.goneLocally(path);
		const goneThere = listing.goneRemotely(path);
		if (goneHere && goneThere) {
			forgotten.push(path);
			continue;
		}
		if (synced.kind === "folder") {
			if (goneHere && remote.get(path)?.kind === "folder") foldersToRemote.push(path);
			else if (goneThere && localFolders.has(path)) foldersToVault.push(path);
			continue;
		}
		if (goneHere) {
			const there = remote.get(path);
			if (there?.kind !== "file") continue;
			const revision = there.revision === synced.revision ? there.revision : await checks.remoteRevisionIfUnchanged(path, synced);
			if (revision === null) remoteChanged.push(path);
			else toRemote.push({ path, revision });
		} else if (goneThere) {
			const here = localFiles.get(path);
			if (here === undefined) continue;
			((await checks.unchangedHere(here, synced)) ? toVault : localChanged).push(path);
		}
	}
	return { toRemote, remoteChanged, toVault, localChanged, foldersToRemote, foldersToVault, forgotten };
}
