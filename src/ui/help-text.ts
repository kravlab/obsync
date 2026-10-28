import { METADATA_FOLDER } from "../engine/remote-metadata";
import { fill } from "./i18n/fill";
import type { Strings } from "./i18n/strings";

/** One section of help: its heading, its paragraphs, then a list, empty when it has none. */
export interface HelpSection {
	readonly heading: string;
	readonly paragraphs: readonly string[];
	readonly list: readonly string[];
}

/**
 * The four practices that avoid most conflicts (spec, "Status, notices,
 * guidance", onboarding), in order, as the onboarding and help list them.
 */
export function practices(strings: Strings): string[] {
	return [
		strings.practiceOneDeviceFirst,
		strings.practiceEmptyOrCurrent,
		strings.practiceWaitForSynced,
		strings.practiceSyncAfterOffline,
	];
}

/**
 * The help (spec, "Status, notices, guidance"): the four practices, how to
 * clear Conflict blocks and Conflict copies, the limits of edits outside
 * the plugin with the Metadata folder warning, the configuration
 * categories with the secrets warning and the restart, what never syncs,
 * and skipped files with their reasons.
 */
export function helpSections(strings: Strings): HelpSection[] {
	return [
		{ heading: strings.helpPracticesHeading, paragraphs: [], list: practices(strings) },
		{ heading: strings.helpConflictsHeading, paragraphs: [strings.helpConflictBlocks, strings.helpConflictCopies], list: [] },
		{
			heading: strings.helpOutsideHeading,
			paragraphs: [strings.helpOutsideEdits, fill(strings.helpMetadataFolder, { folder: METADATA_FOLDER })],
			list: [],
		},
		{
			heading: strings.helpConfigurationHeading,
			paragraphs: [strings.helpConfigurationCategories, strings.helpConfigurationSecrets, strings.helpConfigurationRestart],
			list: [],
		},
		{
			heading: strings.helpSkippedHeading,
			paragraphs: [strings.helpNeverSynced, strings.helpSkipped],
			list: [strings.helpSkippedIgnored, strings.helpSkippedName, strings.helpSkippedCase, strings.helpSkippedSize],
		},
	];
}
