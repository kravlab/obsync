import type { ActivityEvent } from "../engine/activity-log";
import type { SyncConflicts } from "../engine/conflicts";
import type { SyncStatus } from "../engine/status";
import type { SkippedFile } from "../engine/sync-listing";
import { activityLine } from "./activity-text";
import { fill } from "./i18n/fill";
import { selectStrings } from "./i18n/strings";
import { statusText } from "./status-text";

/** What a bug report tells about this device. */
export interface BugReportFacts {
	/** This plugin's version (`manifest.version`). */
	readonly pluginVersion: string;
	/** Obsidian's version (`apiVersion`). */
	readonly obsidianVersion: string;
	/** The platform, as a device is named by default: Desktop, Android, iPhone or iPad. */
	readonly platform: string;
	readonly status: SyncStatus;
	readonly conflicts: SyncConflicts;
	readonly skipped: readonly SkippedFile[];
	/** The activity log, newest first. */
	readonly activity: readonly ActivityEvent[];
}

/**
 * The text "Copy for a bug report" copies: the versions, the platform, the
 * status with its counts, then every event of the activity log, newest
 * first. It is always in English, whatever the user's language, since it
 * is read by the plugin's developers. It holds vault paths, as the
 * events name them.
 */
export function bugReport(facts: BugReportFacts): string {
	const strings = selectStrings("en");
	const events = facts.activity.map((event) => activityLine(event, strings));
	return [
		strings.bugReportTitle,
		fill(strings.bugReportPluginVersion, { version: facts.pluginVersion }),
		fill(strings.bugReportObsidianVersion, { version: facts.obsidianVersion }),
		fill(strings.bugReportPlatform, { platform: facts.platform }),
		fill(strings.bugReportStatus, { status: statusText(facts.status, facts.conflicts, facts.skipped, strings) }),
		strings.bugReportActivity,
		...(events.length === 0 ? [strings.bugReportNoActivity] : events),
	].join("\n");
}
