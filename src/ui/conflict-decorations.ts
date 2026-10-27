/**
 * Conflict blocks in the editor (spec, "Architecture and modules", editor
 * extension): the markers stay as they are in the file, each side is
 * tinted, and a row of actions sits above every block's `<<<<<<<` line.
 * Every action is an ordinary edit of the note, which the next sync
 * uploads like any other.
 *
 * Live Preview reads the markers as Markdown: `=======` makes the line
 * above it a setext heading, and `>>>>>>>` a quote seven levels deep,
 * drawn as seven bars with a hanging indent that Obsidian writes into the
 * line's element, running on to the lines after the block up to a blank
 * line. Each marker line is therefore shown as a block of its own holding
 * its text, in place of the editor's line, which Obsidian neither styles
 * nor indents; the lines after a block carry a class of their own, and
 * styles.css undoes the heading's styling on the block's sides and the
 * quote's on those lines. As Live Preview does with all Markdown, a marker
 * line the cursor or a selection is on is the editor's line again, edited
 * as typed; a click on the block puts the cursor there.
 *
 * The decorations come from a CodeMirror state field, since block widgets
 * must not come from a view plugin, and are recomputed whenever the
 * document or the selection changes; a document is parsed once.
 */
import { StateField, type EditorState, type Range, type Text } from "@codemirror/state";
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

/**
 * The line class of the lines after a block, up to a blank line or one
 * starting a quote of the note's own, which Markdown reads as part of the
 * `>>>>>>>` quote.
 */
const AFTER_CLASS = "obsync-conflict-after";

/** A line starting a quote of its own, as Markdown reads it: up to three spaces, then `>`. */
const QUOTE_START = /^ {0,3}>/;

/** The state field drawing every Conflict block of the note with `options`. */
export function conflictDecorations(options: ConflictRowOptions): StateField<DecorationSet> {
	/** The blocks of each document parsed, kept while the document is in use. */
	const parsed = new WeakMap<Text, readonly ConflictBlock[]>();
	/** The blocks of `doc`, parsed the first time only. */
	const blocksOf = (doc: Text): readonly ConflictBlock[] => {
		const known = parsed.get(doc);
		if (known !== undefined) return known;
		const blocks = conflictBlocks(doc.toString());
		parsed.set(doc, blocks);
		return blocks;
	};
	return StateField.define<DecorationSet>({
		create: (state) => decorationsOf(state, blocksOf(state.doc), options),
		update: (decorations, transaction) =>
			transaction.docChanged || transaction.selection !== undefined
				? decorationsOf(transaction.state, blocksOf(transaction.state.doc), options)
				: decorations,
		provide: (field) => EditorView.decorations.from(field),
	});
}

/** The decorations of `blocks`, every Conflict block in `state`. */
function decorationsOf(state: EditorState, blocks: readonly ConflictBlock[], options: ConflictRowOptions): DecorationSet {
	const { doc } = state;
	const ranges: Range<Decoration>[] = [];
	/** Every block's marker lines, numbered from 0. */
	const markers = new Set(blocks.flatMap((block) => [block.startLine, block.separatorLine, block.endLine]));
	/** The classes of each line numbered from 0, outer blocks' tints included. */
	const classes = new Map<number, string[]>();
	/** Adds `className` to the line numbered `line` from 0, once. */
	const tint = (line: number, className: string): void => {
		const names = classes.get(line) ?? [];
		if (!names.includes(className)) classes.set(line, [...names, className]);
	};
	/** Whether the cursor or a selection is on the text from `from` to `to`. */
	const selected = (from: number, to: number): boolean => state.selection.ranges.some((range) => range.from <= to && from <= range.to);
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
		// An outer block's marker on the way is no quote: it is shown as a block of its own.
		for (let line = block.endLine + 1; line < doc.lines; line += 1) {
			const { text } = doc.line(line + 1);
			if (text.trim() === "" || QUOTE_START.test(text)) break;
			if (!markers.has(line)) tint(line, AFTER_CLASS);
		}
	}
	for (const [line, names] of classes) {
		const { from, to, text } = doc.line(line + 1);
		if (markers.has(line) && !selected(from, to)) {
			ranges.push(Decoration.replace({ widget: new MarkerLine(text, names), block: true }).range(from, to));
		} else {
			for (const name of names) ranges.push(Decoration.line({ class: name }).range(from));
		}
	}
	// Nested blocks put several decorations on one line: the set wants them sorted.
	return Decoration.set(ranges, true);
}

/** A marker line as a block of its own holding the line's text as typed, in place of the editor's line. */
class MarkerLine extends WidgetType {
	/**
	 * @param text the line's text
	 * @param classes the line's classes: the marker's, and an outer block's tint
	 */
	constructor(
		readonly text: string,
		readonly classes: readonly string[],
	) {
		super();
	}

	override eq(other: MarkerLine): boolean {
		return this.text === other.text && this.classes.join(" ") === other.classes.join(" ");
	}

	/**
	 * The block; pressing it puts the cursor on the line, which shows it as
	 * typed, and then where the press is in that text, as the editor places
	 * a click (the line's start where it cannot tell). The editor itself
	 * would select the whole block, line break included, for typing to
	 * replace.
	 */
	override toDOM(view: EditorView): HTMLElement {
		// Built by the editor's own window, as the action row is.
		const block = (view.dom.win as typeof window).createDiv({ cls: [...this.classes], text: this.text });
		block.addEventListener("mousedown", (event) => {
			if (event.button !== 0) return;
			event.preventDefault();
			const line = view.state.doc.lineAt(view.posAtDOM(block));
			view.dispatch({ selection: { anchor: line.from } });
			const pressed = view.posAtCoords({ x: event.clientX, y: event.clientY });
			if (pressed !== null && pressed > line.from && pressed <= line.to) view.dispatch({ selection: { anchor: pressed } });
			view.focus();
		});
		return block;
	}
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

