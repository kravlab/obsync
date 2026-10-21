/**
 * What is left in conflict on this device, for the Sync window's Conflicts
 * tab and the conflict count (spec, "Status, notices, guidance"): synced
 * files holding Conflict blocks, Conflict copies, and the local versions
 * kept on configuration conflicts. It is read from the Sync snapshot, so
 * it is known at once after a restart and changes only as syncs record
 * files; an edit resolving blocks shows once it is synced.
 */
import { conflictBlocks } from "./conflict-blocks";
import { isConflictCopy } from "./conflict-copy";
import type { VaultPath } from "./local-vault";
import { comparePaths } from "./paths";
import type { KeptConfiguration } from "./ports";
import type { SyncSnapshot } from "./sync-snapshot";

/** The conflicts left on this device. */
export interface SyncConflicts {
	/** Synced files whose content holds Conflict blocks, ordered by path. */
	readonly conflicted: readonly VaultPath[];
	/** Synced Conflict copies, ordered by path. */
	readonly copies: readonly VaultPath[];
	/** The local versions kept on configuration conflicts, newest first. */
	readonly configuration: readonly KeptConfiguration[];
}

/** No conflicts at all, as a device without a Connection has. */
export const NO_CONFLICTS: SyncConflicts = { conflicted: [], copies: [], configuration: [] };

/** Whether `text` holds at least one Conflict block, as the editor finds them. */
export function holdsConflictBlocks(text: string): boolean {
	return conflictBlocks(text).length > 0;
}

/**
 * The conflicts recorded in `snapshot`, with the kept configuration
 * versions `kept` (newest first, as the store lists them). A Conflict copy
 * is told by its name only, so one that also holds Conflict blocks is
 * listed under both.
 */
export function conflictsOf(snapshot: SyncSnapshot, kept: readonly KeptConfiguration[]): SyncConflicts {
	const conflicted: VaultPath[] = [];
	const copies: VaultPath[] = [];
	for (const [path, entry] of snapshot) {
		if (entry.kind !== "file") continue;
		if (entry.conflicted === true) conflicted.push(path);
		if (isConflictCopy(path)) copies.push(path);
	}
	return { conflicted: conflicted.sort(comparePaths), copies: copies.sort(comparePaths), configuration: kept };
}

/** How many conflicts `conflicts` holds in all, the number shown next to the sync status. */
export function conflictCount(conflicts: SyncConflicts): number {
	return conflicts.conflicted.length + conflicts.copies.length + conflicts.configuration.length;
}
