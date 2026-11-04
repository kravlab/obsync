/**
 * The two sides of a Conflict block as every view shows them: the editor's
 * action row, the Edit… dialog and the reading-view panel. A side keeps
 * the label in its marker; a marker without one reads "First version" or
 * "Second version", so the sides can always be told apart.
 */
import type { ConflictBlock } from "../engine/conflict-blocks";
import { fill } from "./i18n/fill";
import type { Strings } from "./i18n/strings";

/** The class of marker lines, shown in the editor as blocks of their own; styled in styles.css. */
export const MARKER_CLASS = "seamsync-conflict-marker";

/** The class of this device's side, styled in styles.css. */
export const LOCAL_CLASS = "seamsync-conflict-local";

/** The class of the other device's side, styled in styles.css. */
export const REMOTE_CLASS = "seamsync-conflict-remote";

/** One side of a Conflict block as the UI shows it. */
export interface ShownSide {
	/** The side's name: its marker's label, or "First version" / "Second version". */
	readonly label: string;
	/** The action keeping this side, such as "Keep Laptop". */
	readonly keepLabel: string;
	/** The side's lines, each with its line break. */
	readonly text: string;
	/** The side's class. */
	readonly cls: string;
}

/** The sides of `block`, this device's first, in the language of `strings`. */
export function shownSides(block: ConflictBlock, strings: Strings): readonly [ShownSide, ShownSide] {
	return [
		{
			label: block.localLabel === "" ? strings.conflictFirstVersion : block.localLabel,
			keepLabel: block.localLabel === "" ? strings.conflictKeepFirst : fill(strings.conflictKeep, { label: block.localLabel }),
			text: block.local,
			cls: LOCAL_CLASS,
		},
		{
			label: block.remoteLabel === "" ? strings.conflictSecondVersion : block.remoteLabel,
			keepLabel:
				block.remoteLabel === "" ? strings.conflictKeepSecond : fill(strings.conflictKeep, { label: block.remoteLabel }),
			text: block.remote,
			cls: REMOTE_CLASS,
		},
	];
}
