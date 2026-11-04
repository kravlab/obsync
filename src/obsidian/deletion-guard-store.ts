import type { App } from "obsidian";
import { DEFAULT_DELETION_GUARD, deletionGuardOf, type DeletionGuardSettings } from "../engine/deletion-guard";

/** The localStorage key of this vault's Deletion guard thresholds. */
const DELETION_GUARD_KEY = "seamsync-deletion-guard";

/** The format version of the stored thresholds. */
const DELETION_GUARD_FORMAT_VERSION = 1;

/** The thresholds as a device stores them. */
interface StoredDeletionGuard {
	/** The record's format; another version reads as the defaults. */
	readonly formatVersion: typeof DELETION_GUARD_FORMAT_VERSION;
	/** N, in files. */
	readonly maxFiles: number;
	/** P, in percent. */
	readonly maxPercent: number;
}

/**
 * This device's Deletion guard thresholds, in Obsidian's per-vault
 * localStorage: never in `data.json` or the vault, and apart from the
 * Connection, so a disconnect keeps them.
 */
export class ObsidianDeletionGuardStore {
	/** @param app the Obsidian app whose localStorage holds the thresholds */
	constructor(private readonly app: App) {}

	/** The stored thresholds, or the defaults when none are stored or they are unreadable. */
	load(): DeletionGuardSettings {
		return storedDeletionGuard(this.app.loadLocalStorage(DELETION_GUARD_KEY));
	}

	/** Stores `settings`; the next sync checks against them. */
	save(settings: DeletionGuardSettings): void {
		this.app.saveLocalStorage(DELETION_GUARD_KEY, storableDeletionGuard(settings));
	}
}

/**
 * The thresholds in a stored record, as `App.loadLocalStorage` returns it;
 * the defaults when the record is missing, of another format version, or
 * holds a value the settings do not take.
 */
export function storedDeletionGuard(stored: unknown): DeletionGuardSettings {
	const record = stored as Partial<StoredDeletionGuard> | null;
	const settings =
		typeof record === "object" &&
		record?.formatVersion === DELETION_GUARD_FORMAT_VERSION &&
		typeof record.maxFiles === "number" &&
		typeof record.maxPercent === "number"
			? deletionGuardOf(record.maxFiles, record.maxPercent)
			: null;
	return settings ?? DEFAULT_DELETION_GUARD;
}

/** The record `App.saveLocalStorage` keeps for `settings`. */
export function storableDeletionGuard(settings: DeletionGuardSettings): StoredDeletionGuard {
	return {
		formatVersion: DELETION_GUARD_FORMAT_VERSION,
		maxFiles: settings.maxFiles,
		maxPercent: settings.maxPercent,
	};
}
