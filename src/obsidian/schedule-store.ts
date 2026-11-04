import type { App } from "obsidian";
import {
	DEFAULT_SYNC_SCHEDULE,
	editPauseOf,
	pollIntervalOf,
	type SyncSchedule,
} from "../engine/sync-schedule";

/** The localStorage key of this vault's sync schedule settings. */
const SCHEDULE_KEY = "seamsync-schedule";

/** The format version of the stored schedule. */
const SCHEDULE_FORMAT_VERSION = 1;

/** The schedule as a device stores it. */
interface StoredSyncSchedule {
	/** The record's format; another version reads as the defaults. */
	readonly formatVersion: typeof SCHEDULE_FORMAT_VERSION;
	/** The post-edit pause in seconds. */
	readonly editPauseSeconds: number;
	/** The polling interval in seconds. */
	readonly pollIntervalSeconds: number;
}

/**
 * This device's sync schedule settings (post-edit pause and polling
 * interval), in Obsidian's per-vault localStorage: never in `data.json` or
 * the vault, and apart from the Connection, so a disconnect keeps them.
 */
export class ObsidianScheduleStore {
	/** @param app the Obsidian app whose localStorage holds the schedule */
	constructor(private readonly app: App) {}

	/** The stored schedule, or the defaults when none is stored or it is unreadable. */
	load(): SyncSchedule {
		return storedSyncSchedule(this.app.loadLocalStorage(SCHEDULE_KEY));
	}

	/** Stores `schedule`. */
	save(schedule: SyncSchedule): void {
		this.app.saveLocalStorage(SCHEDULE_KEY, storableSyncSchedule(schedule));
	}
}

/**
 * The schedule in a stored record, as `App.loadLocalStorage` returns it;
 * the defaults when the record is missing, of another format version, or
 * holds a value the settings do not take.
 */
export function storedSyncSchedule(stored: unknown): SyncSchedule {
	const record = stored as Partial<StoredSyncSchedule> | null;
	if (typeof record !== "object" || record?.formatVersion !== SCHEDULE_FORMAT_VERSION) {
		return DEFAULT_SYNC_SCHEDULE;
	}
	const editPause = typeof record.editPauseSeconds === "number" ? editPauseOf(record.editPauseSeconds) : null;
	const pollInterval =
		typeof record.pollIntervalSeconds === "number" ? pollIntervalOf(record.pollIntervalSeconds) : null;
	if (editPause === null || pollInterval === null) return DEFAULT_SYNC_SCHEDULE;
	return { editPause, pollInterval };
}

/** The record `App.saveLocalStorage` keeps for `schedule`. */
export function storableSyncSchedule(schedule: SyncSchedule): StoredSyncSchedule {
	return {
		formatVersion: SCHEDULE_FORMAT_VERSION,
		editPauseSeconds: schedule.editPause.seconds,
		pollIntervalSeconds: schedule.pollInterval.seconds,
	};
}
