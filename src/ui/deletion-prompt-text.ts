import type { DeletionPrompt } from "../engine/deletion-guard";
import { fill } from "./i18n/fill";
import type { Strings } from "./i18n/strings";

/** The words of a Deletion guard prompt, apart from its buttons and list. */
export interface DeletionPromptText {
	/** Why the sync stopped. */
	readonly reason: string;
	/** How many files deleted here would be deleted in Dropbox; null when none would. */
	readonly toRemote: string | null;
	/** How many files deleted elsewhere would go to this device's trash; null when none would. */
	readonly toVault: string | null;
}

/** The words of `prompt` in the user's language. */
export function deletionPromptText(prompt: DeletionPrompt, strings: Strings): DeletionPromptText {
	const counted = (template: string, paths: readonly string[]): string | null =>
		paths.length === 0 ? null : fill(template, { count: String(paths.length) });
	return {
		reason: reasonText(prompt.reason, strings),
		toRemote: counted(strings.guardToRemote, prompt.toRemote),
		toVault: counted(strings.guardToVault, prompt.toVault),
	};
}

/** Why the guard stopped a sync, in the user's language. */
function reasonText(reason: DeletionPrompt["reason"], strings: Strings): string {
	switch (reason) {
		case "threshold":
			return strings.guardReasonThreshold;
		case "missingVault":
			return strings.guardReasonMissingVault;
		case "emptyRemote":
			return strings.guardReasonEmptyRemote;
	}
}
