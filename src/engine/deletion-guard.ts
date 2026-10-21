/**
 * The Deletion guard (glossary; spec, "Deletions and renames"): a sync that
 * would delete more than N files, or more than P % of the synced files, in
 * either direction stops and asks the user first; so does one whose vault
 * or Remote has lost every synced file. N and P are per-device settings.
 */
import type { VaultPath } from "./local-vault";
import { isWholeNumberIn, parseWholeNumber } from "./whole-number";

/** The most files a sync deletes in one direction without asking, until the user sets it. */
const DEFAULT_MAX_FILES = 100;

/**
 * The largest share of the synced files, in percent, a sync deletes in one
 * direction without asking, until the user sets it; rclone bisync's
 * `--max-delete` default.
 */
const DEFAULT_MAX_PERCENT = 50;

/** The largest file count the setting takes. */
const MAX_FILES_LIMIT = 100_000;

/** This device's Deletion guard thresholds. */
export interface DeletionGuardSettings {
	/** N: the most files one direction deletes without asking, 1 to 100000. */
	readonly maxFiles: number;
	/** P: the largest share of the synced files, in percent, one direction deletes without asking, 1 to 100. */
	readonly maxPercent: number;
}

/** The thresholds a device has until its user sets them. */
export const DEFAULT_DELETION_GUARD: DeletionGuardSettings = {
	maxFiles: DEFAULT_MAX_FILES,
	maxPercent: DEFAULT_MAX_PERCENT,
};

/**
 * What one sync is about to do, in files; folders are not counted.
 */
export interface DeletionCounts {
	/** Files in the Sync snapshot. */
	readonly syncedFiles: number;
	/** Synced files the vault still holds; files new since the snapshot are not counted. */
	readonly vaultFiles: number;
	/** Synced files the Remote still holds; files new since the snapshot are not counted. */
	readonly remoteFiles: number;
	/** Files deleted on this device that the sync would delete on the Remote. */
	readonly toRemote: number;
	/** Files deleted on the Remote that the sync would trash in the vault. */
	readonly toVault: number;
}

/**
 * Why a sync stops and asks before deleting:
 * - `missingVault`: the vault has none of its synced files left, whatever it holds besides;
 * - `emptyRemote`: the Remote has none of the synced files left, whatever it holds besides;
 * - `threshold`: one direction deletes more than N files or more than P % of the synced files.
 */
export type GuardReason = "missingVault" | "emptyRemote" | "threshold";

/**
 * What the guard asks the user (spec, "Status, notices, guidance", modal
 * prompts): why it stopped, and every file the sync would delete, on the
 * Remote and in the vault, for the review list.
 */
export interface DeletionPrompt {
	readonly reason: GuardReason;
	/** Files deleted on this device that the sync would delete on the Remote. */
	readonly toRemote: readonly VaultPath[];
	/** Files deleted on the Remote that the sync would move to this device's trash. */
	readonly toVault: readonly VaultPath[];
}

/**
 * The user's answer to a `DeletionPrompt`: `apply` the deletions,
 * `restore` the files to the side they were deleted from, or null when the
 * prompt was closed without a choice, which holds sync.
 */
export type DeletionAnswer = "apply" | "restore" | null;

/**
 * Why the guard stops a sync about to do `counts` under `settings`, or
 * null when the sync goes on without asking. A lost vault or Remote is
 * reported whatever N and P allow, since its deletions would wipe the
 * other side.
 */
export function guardReason(counts: DeletionCounts, settings: DeletionGuardSettings): GuardReason | null {
	const { syncedFiles, vaultFiles, remoteFiles, toRemote, toVault } = counts;
	if (syncedFiles === 0) return null;
	if (vaultFiles === 0) return "missingVault";
	if (remoteFiles === 0) return "emptyRemote";
	const tooMany = (deleted: number): boolean =>
		deleted > settings.maxFiles || deleted * 100 > settings.maxPercent * syncedFiles;
	return tooMany(toRemote) || tooMany(toVault) ? "threshold" : null;
}

/** The thresholds `maxFiles` and `maxPercent`, or null when the settings do not take either. */
export function deletionGuardOf(maxFiles: number, maxPercent: number): DeletionGuardSettings | null {
	return isWholeNumberIn(maxFiles, 1, MAX_FILES_LIMIT) && isWholeNumberIn(maxPercent, 1, 100)
		? { maxFiles, maxPercent }
		: null;
}

/** The file count N the user typed, or null when the setting does not take it. */
export function parseMaxDeletedFiles(typed: string): number | null {
	return parseWholeNumber(typed, 1, MAX_FILES_LIMIT);
}

/** The percentage P the user typed, or null when the setting does not take it. */
export function parseMaxDeletedPercent(typed: string): number | null {
	return parseWholeNumber(typed, 1, 100);
}
