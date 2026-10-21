/**
 * The sync schedule settings (spec, "Sync triggers and lifecycle"): how
 * long the vault stays quiet after an edit before a sync starts (and how
 * long the open note is left alone after typing), and how often the Remote
 * is polled while Obsidian is open. Both are per-device settings in whole
 * seconds.
 */
import { isWholeNumberIn, parseWholeNumber } from "./whole-number";

/** One second in milliseconds. */
const SECOND_MS = 1000;

/** The post-edit pause a device starts with, in seconds. */
const DEFAULT_EDIT_PAUSE_SECONDS = 2;

/** The shortest post-edit pause the setting takes, in seconds. */
const MIN_EDIT_PAUSE_SECONDS = 1;

/** The longest post-edit pause the setting takes, in seconds. */
const MAX_EDIT_PAUSE_SECONDS = 60;

/** The polling interval a device starts with, in seconds. */
const DEFAULT_POLL_INTERVAL_SECONDS = 60;

/** The shortest polling interval the setting takes, in seconds. */
const MIN_POLL_INTERVAL_SECONDS = 10;

/** The longest polling interval the setting takes, in seconds. */
const MAX_POLL_INTERVAL_SECONDS = 3600;

/** A schedule setting's duration, in the setting's unit and in milliseconds. */
export interface SecondsSetting {
	/** The duration as the user sets it: a whole number of seconds. */
	readonly seconds: number;
	/** The same duration in milliseconds. */
	readonly ms: number;
}

/** This device's sync schedule settings. */
export interface SyncSchedule {
	/**
	 * How long the vault stays quiet after an edit before a sync starts, and
	 * how long the note being typed in is left alone: 1 to 60 s.
	 */
	readonly editPause: SecondsSetting;
	/** How often the Remote is polled while Obsidian is open: 10 to 3600 s. */
	readonly pollInterval: SecondsSetting;
}

/** The post-edit pause a device has until its user sets one. */
export const DEFAULT_EDIT_PAUSE: SecondsSetting = durationOf(DEFAULT_EDIT_PAUSE_SECONDS);

/** The polling interval a device has until its user sets one. */
export const DEFAULT_POLL_INTERVAL: SecondsSetting = durationOf(DEFAULT_POLL_INTERVAL_SECONDS);

/** The sync schedule a device has until its user sets one. */
export const DEFAULT_SYNC_SCHEDULE: SyncSchedule = {
	editPause: DEFAULT_EDIT_PAUSE,
	pollInterval: DEFAULT_POLL_INTERVAL,
};

/** The post-edit pause of `seconds` s, or null when the setting does not take it. */
export function editPauseOf(seconds: number): SecondsSetting | null {
	return isWholeNumberIn(seconds, MIN_EDIT_PAUSE_SECONDS, MAX_EDIT_PAUSE_SECONDS) ? durationOf(seconds) : null;
}

/** The post-edit pause the user typed, or null when it is not one. */
export function parseEditPause(typed: string): SecondsSetting | null {
	const seconds = parseWholeNumber(typed, MIN_EDIT_PAUSE_SECONDS, MAX_EDIT_PAUSE_SECONDS);
	return seconds === null ? null : durationOf(seconds);
}

/** The polling interval of `seconds` s, or null when the setting does not take it. */
export function pollIntervalOf(seconds: number): SecondsSetting | null {
	return isWholeNumberIn(seconds, MIN_POLL_INTERVAL_SECONDS, MAX_POLL_INTERVAL_SECONDS) ? durationOf(seconds) : null;
}

/** The polling interval the user typed, or null when it is not one. */
export function parsePollInterval(typed: string): SecondsSetting | null {
	const seconds = parseWholeNumber(typed, MIN_POLL_INTERVAL_SECONDS, MAX_POLL_INTERVAL_SECONDS);
	return seconds === null ? null : durationOf(seconds);
}

/** The duration of `seconds` s in seconds and milliseconds. */
function durationOf(seconds: number): SecondsSetting {
	return { seconds, ms: seconds * SECOND_MS };
}
