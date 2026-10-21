import type { SkippedFile, SkipReason } from "../engine/sync-listing";
import { fill } from "./i18n/fill";
import type { Strings } from "./i18n/strings";

/** "N skipped", shown after the sync status, in the user's language; null when nothing is skipped. */
export function skippedCount(files: readonly SkippedFile[], strings: Strings): string | null {
	return files.length === 0 ? null : fill(strings.skippedCount, { count: String(files.length) });
}

/** The status text `status` with the skipped count after it, or `status` alone when nothing is skipped. */
export function withSkippedCount(status: string, files: readonly SkippedFile[], strings: Strings): string {
	const skipped = skippedCount(files, strings);
	return skipped === null ? status : fill(strings.statusWithSkipped, { status, skipped });
}

/**
 * One line per skipped file, in the order given: its vault path and why it
 * does not sync. Beyond `limit` files, one last line tells how many more
 * there are, so a long list (a whole ignored folder) stays readable.
 */
export function skippedLines(files: readonly SkippedFile[], strings: Strings, limit = Number.POSITIVE_INFINITY): string[] {
	const lines = files.slice(0, limit).map(({ path, reason }) => fill(lineTemplate(reason, strings), { file: path }));
	const more = files.length - lines.length;
	return more > 0 ? [...lines, fill(strings.skippedMore, { count: String(more) })] : lines;
}

/** The line telling a skipped file and why it does not sync, with a `{file}` placeholder, in the user's language. */
function lineTemplate(reason: SkipReason, strings: Strings): string {
	switch (reason) {
		case "ignored":
			return strings.skippedIgnored;
		case "nameNotRepresentable":
			return strings.skippedNameNotRepresentable;
		case "caseClash":
			return strings.skippedCaseClash;
		case "tooLarge":
			return strings.skippedTooLarge;
	}
}
