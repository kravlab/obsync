import { Notice, type Editor } from "obsidian";
import { adjacentBlock, conflictBlocks, type BlockDirection } from "../engine/conflict-blocks";
import type { Strings } from "./i18n/strings";

/**
 * "Next conflict" and "Previous conflict": moves the cursor of `editor` to
 * the start of the next or previous Conflict block's `<<<<<<<` line,
 * wrapping around; a note without blocks shows a notice instead.
 */
export function moveToConflict(editor: Editor, direction: BlockDirection, strings: Strings): void {
	const target = adjacentBlock(conflictBlocks(editor.getValue()), editor.getCursor().line, direction);
	if (target === null) {
		new Notice(strings.noConflicts);
		return;
	}
	revealLine(editor, target.startLine);
}

/**
 * Puts the cursor of `editor` on its first Conflict block's `<<<<<<<`
 * line, as a note opened from the Sync window's Conflicts tab lands; a
 * note without blocks, resolved meanwhile, is left as it opened.
 */
export function moveToFirstConflict(editor: Editor): void {
	const [first] = conflictBlocks(editor.getValue());
	if (first !== undefined) revealLine(editor, first.startLine);
}

/** Moves the cursor of `editor` to the start of `line` and scrolls it into view, centred. */
function revealLine(editor: Editor, line: number): void {
	const position = { line, ch: 0 };
	editor.setCursor(position);
	editor.scrollIntoView({ from: position, to: position }, true);
}
