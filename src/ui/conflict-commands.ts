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
	const position = { line: target.startLine, ch: 0 };
	editor.setCursor(position);
	editor.scrollIntoView({ from: position, to: position }, true);
}
