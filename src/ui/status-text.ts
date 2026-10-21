import { conflictCount, type SyncConflicts } from "../engine/conflicts";
import type { SyncStatus } from "../engine/status";
import type { SkippedFile } from "../engine/sync-listing";
import { fill } from "./i18n/fill";
import type { Strings } from "./i18n/strings";
import { skippedCount } from "./skipped-text";
import { statusLabel } from "./status-label";

/**
 * The sync status with the counts of conflicts and skipped files after
 * it, each only when it is not zero, in the user's language: what the
 * status bar item, the ribbon icon's tooltip and the Sync window show.
 */
export function statusText(
	status: SyncStatus,
	conflicts: SyncConflicts,
	skipped: readonly SkippedFile[],
	strings: Strings,
): string {
	const conflicted = conflictCount(conflicts);
	const counts = [conflicted > 0 ? fill(strings.conflictsCount, { count: String(conflicted) }) : null, skippedCount(skipped, strings)];
	return counts.reduce<string>(
		(text, count) => (count === null ? text : fill(strings.statusWithCount, { status: text, count })),
		statusLabel(status, strings),
	);
}
