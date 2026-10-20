/**
 * Conflict blocks in the editor (spec, "Architecture and modules", editor
 * extension): the markers stay as they are in the file, each side is
 * tinted, and a row of actions sits above every block's `<<<<<<<` line.
 * Every action is an ordinary edit of the note, which the next sync
 * uploads like any other.
 *
 * The decorations come from a CodeMirror state field, since block widgets
 * must not come from a view plugin, and are recomputed whenever the
 * document changes.
 */
import { StateField, type EditorState, type Range } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import {
	conflictBlocks,
	findBlock,
	resolutionOf,
	type ConflictAction,
	type ConflictBlock,
} from "../engine/conflict-blocks";
import { LOCAL_CLASS, MARKER_CLASS, REMOTE_CLASS, shownSides } from "./conflict-sides";
import type { Strings } from "./i18n/strings";

/** What the action rows are built with. */
export interface ConflictRowOptions {
	/** The UI strings in the user's language. */
	readonly strings: Strings;
	/** On a phone the actions are buttons at least 44 px tall. */
	readonly isPhone: boolean;
	/**
	 * Opens the Edit… dialog for `block`; `apply` replaces the block with
	 * the text the user saved, and returns false, changing nothing, when
	 * the block is no longer there as it was shown.
	 */
	readonly editBlock: (block: ConflictBlock, apply: (text: string) => boolean) => void;
}

/** The line class of this device's side of a block nested in another block's side; the outer tint stays visible. */
const NESTED_LOCAL_CLASS = "obsync-conflict-nested-local";

/** The line class of the other device's side of a nested block; the outer tint stays visible. */
const NESTED_REMOTE_CLASS = "obsync-conflict-nested-remote";

/** The state field drawing every Conflict block of the note with `options`. */
export function conflictDecorations(options: ConflictRowOptions): StateField<DecorationSet> {
	return StateField.define<DecorationSet>({
		create: (state) => decorationsOf(state, options),
		update: (decorations, transaction) =>
			transaction.docChanged ? decorationsOf(transaction.state, options) : decorations,
		provide: (field) => EditorView.decorations.from(field),
	});
}

/** The decorations of every Conflict block in `state`. */
function decorationsOf(state: EditorState, options: ConflictRowOptions): DecorationSet {
	const { doc } = state;
	const ranges: Range<Decoration>[] = [];
	/** Adds `className` to the line numbered `line` from 0. */
	const tint = (line: number, className: string): void => {
		ranges.push(Decoration.line({ class: className }).range(doc.line(line + 1).from));
	};
	const blocks = conflictBlocks(doc.toString());
	for (const block of blocks) {
		const nested = blocks.some((outer) => outer.startLine < block.startLine && block.endLine < outer.endLine);
		const start = doc.line(block.startLine + 1).from;
		ranges.push(Decoration.widget({ widget: new ConflictActions(block, options), block: true, side: -1 }).range(start));
		tint(block.startLine, MARKER_CLASS);
		for (let line = block.startLine + 1; line < block.separatorLine; line += 1) {
			tint(line, nested ? NESTED_LOCAL_CLASS : LOCAL_CLASS);
		}
		tint(block.separatorLine, MARKER_CLASS);
		for (let line = block.separatorLine + 1; line < block.endLine; line += 1) {
			tint(line, nested ? NESTED_REMOTE_CLASS : REMOTE_CLASS);
		}
		tint(block.endLine, MARKER_CLASS);
	}
	// Nested blocks put several decorations on one line: the set wants them sorted.
	return Decoration.set(ranges, true);
}

/** The row of actions above a Conflict block. */
class ConflictActions extends WidgetType {
	/**
	 * @param block the block the row resolves, as last parsed
	 * @param options the strings, the phone flag and the dialog opener
	 */
	constructor(
		private readonly block: ConflictBlock,
		private readonly options: ConflictRowOptions,
	) {
		super();
	}

	override eq(other: ConflictActions): boolean {
		const { block } = this;
		return (
			block.startLine === other.block.startLine &&
			block.localLabel === other.block.localLabel &&
			block.remoteLabel === other.block.remoteLabel &&
			block.local === other.block.local &&
			block.remote === other.block.remote
		);
	}

	override toDOM(view: EditorView): HTMLElement {
		const { strings, isPhone, editBlock } = this.options;
		const [local, remote] = shownSides(this.block, strings);
		// Built by the editor's own window, which differs from the main one in a popout window.
		// Obsidian gives every window its DOM helpers; TypeScript only knows them on the global scope.
		const editorWindow = view.dom.win as typeof window;
		const row = editorWindow.createDiv({ cls: isPhone ? "obsync-conflict-actions obsync-phone" : "obsync-conflict-actions" });
		/**
		 * Resolves this row's block by `action` if the note still holds it as
		 * shown; returns whether it did.
		 */
		const apply = (action: ConflictAction): boolean => {
			const text = view.state.doc.toString();
			const current = findBlock(text, this.block);
			if (current === null) return false;
			view.dispatch({ changes: resolutionOf(text, current, action) });
			return true;
		};
		/** Adds a button labelled `text` running `run`. */
		const button = (text: string, run: () => void): void => {
			row.createEl("button", { text }).addEventListener("click", run);
		};
		button(local.keepLabel, () => void apply({ kind: "keepLocal" }));
		button(remote.keepLabel, () => void apply({ kind: "keepRemote" }));
		button(strings.conflictKeepBoth, () => void apply({ kind: "keepBoth" }));
		button(strings.conflictEdit, () => {
			if (findBlock(view.state.doc.toString(), this.block) === null) return;
			editBlock(this.block, (text) => apply({ kind: "replace", text }));
		});
		return row;
	}
}

