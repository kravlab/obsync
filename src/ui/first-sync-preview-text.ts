import type { FirstSyncPreview } from "../engine/first-sync";
import { fill } from "./i18n/fill";
import type { Strings } from "./i18n/strings";

/** The words of a First sync preview, apart from its buttons and the files to download, upload or leave. */
export interface FirstSyncPreviewText {
	/** How many files download. */
	readonly toDownload: string;
	/** How many files upload. */
	readonly toUpload: string;
	/** How many files are the same on both sides. */
	readonly identical: string;
	/** How many files differ. */
	readonly differing: string;
	/** Each differing file with what happens to it by default. */
	readonly differingFiles: readonly string[];
}

/** The words of `preview` in the user's language. */
export function firstSyncPreviewText(preview: FirstSyncPreview, strings: Strings): FirstSyncPreviewText {
	const count = (template: string, paths: readonly unknown[]): string => fill(template, { count: String(paths.length) });
	return {
		toDownload: count(strings.firstSyncToDownload, preview.toDownload),
		toUpload: count(strings.firstSyncToUpload, preview.toUpload),
		identical: count(strings.firstSyncIdentical, preview.identical),
		differing: count(strings.firstSyncDiffering, preview.differing),
		differingFiles: preview.differing.map(
			({ path, outcome }) => `${path}: ${outcome === "merged" ? strings.firstSyncMerged : strings.firstSyncConflictCopy}`,
		),
	};
}
