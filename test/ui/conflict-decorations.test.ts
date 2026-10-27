import { EditorState, type StateField } from "@codemirror/state";
import type { DecorationSet, WidgetType } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { conflictDecorations } from "../../src/ui/conflict-decorations";
import { selectStrings } from "../../src/ui/i18n/strings";

/** A state field over the English strings that never opens a dialog. */
function field(): StateField<DecorationSet> {
	return conflictDecorations({ strings: selectStrings("en"), isPhone: false, editBlock: () => undefined });
}

/** A marker line's start: `<<<<<<<`, `=======` or `>>>>>>>`. */
const MARKER = /^(<{7}|={7}|>{7})/;

/**
 * A state holding `doc` with `decorations`, the cursor at the start of
 * its first line that is no marker line, which the cursor would show as
 * typed.
 */
function stateOf(doc: string, decorations: StateField<DecorationSet>): EditorState {
	const lines = doc.split("\n");
	const line = lines.findIndex((text) => !MARKER.test(text));
	const anchor = lines.slice(0, line).reduce((at, text) => at + text.length + 1, 0);
	return EditorState.create({ doc, extensions: [decorations], selection: { anchor } });
}

/**
 * What the field draws on each line of `state`: line classes, "actions"
 * for an action row before it, and "line: <shown> [<classes>]" for a line
 * it shows as a block of its own in place of the editor's line.
 */
function drawn(state: EditorState, decorations: StateField<DecorationSet>): string[][] {
	const byLine: string[][] = Array.from({ length: state.doc.lines }, () => []);
	state.field(decorations).between(0, state.doc.length, (from, to, decoration) => {
		const line = state.doc.lineAt(from).number - 1;
		const spec = decoration.spec as { class?: string; block?: boolean; widget?: { text?: string; classes?: readonly string[] } };
		if (spec.widget === undefined) byLine[line]?.push(spec.class ?? "?");
		else if (to === from) byLine[line]?.push("actions");
		else byLine[line]?.push(`${spec.block === true ? "line" : "inline"}: ${spec.widget.text ?? "?"} [${[...(spec.widget.classes ?? [])].sort().join(" ")}]`);
	});
	return byLine;
}

describe("Conflict blocks in the editor", () => {
	it("tints each side, shows each marker line as a block of its plain text, and puts an action row before the block", () => {
		const decorations = field();
		const state = stateOf("title\n<<<<<<< Laptop\nmine\n=======\ntheirs\n>>>>>>> Remote\nend", decorations);
		expect(drawn(state, decorations)).toEqual([
			[],
			["actions", "line: <<<<<<< Laptop [obsync-conflict-marker]"],
			["obsync-conflict-local"],
			["line: ======= [obsync-conflict-marker]"],
			["obsync-conflict-remote"],
			["line: >>>>>>> Remote [obsync-conflict-marker]"],
			["obsync-conflict-after"],
		]);
	});

	it("marks the lines after a block up to the first blank line, which Markdown reads as part of the >>>>>>> quote", () => {
		const decorations = field();
		const state = stateOf("<<<<<<< Laptop\nmine\n=======\ntheirs\n>>>>>>> Remote\nafter\nmore\n\nnext", decorations);
		expect(drawn(state, decorations).slice(5)).toEqual([["obsync-conflict-after"], ["obsync-conflict-after"], [], []]);
	});

	it("marks no line from one starting a quote of its own on: the quote is the note's", () => {
		const decorations = field();
		const state = stateOf("<<<<<<< Laptop\nmine\n=======\ntheirs\n>>>>>>> Remote\nafter\n> quoted\nlazy", decorations);
		expect(drawn(state, decorations).slice(5)).toEqual([["obsync-conflict-after"], [], []]);
	});

	it("gives a side's line in a block nested twice each class once", () => {
		const decorations = field();
		const note = ["<<<<<<< P", "<<<<<<< L", "<<<<<<< M", "x", "=======", "y", ">>>>>>> R", "=======", "z", ">>>>>>> R", "=======", "w", ">>>>>>> R"];
		const state = stateOf(note.join("\n"), decorations);
		expect([...(drawn(state, decorations)[3] ?? [])].sort()).toEqual(["obsync-conflict-local", "obsync-conflict-nested-local"]);
	});

	it("shows a marker line the cursor or a selection is on as the editor's line, still marked, so it is edited as typed", () => {
		const decorations = field();
		let state = stateOf("<<<<<<< Laptop\nmine\n=======\ntheirs\n>>>>>>> Remote\nafter", decorations);
		const end = state.doc.line(5);
		state = state.update({ selection: { anchor: end.from + 3 } }).state;
		expect(drawn(state, decorations).slice(3, 5)).toEqual([["obsync-conflict-remote"], ["obsync-conflict-marker"]]);
		// At the line's end too.
		state = state.update({ selection: { anchor: end.to } }).state;
		expect(drawn(state, decorations)[4]).toEqual(["obsync-conflict-marker"]);
		// A selection from the side into the marker line.
		state = state.update({ selection: { anchor: state.doc.line(4).from, head: end.from } }).state;
		expect(drawn(state, decorations)[4]).toEqual(["obsync-conflict-marker"]);
		// The cursor gone, the line is a block of its text again.
		state = state.update({ selection: { anchor: state.doc.line(2).from } }).state;
		expect(drawn(state, decorations)[4]).toEqual(["line: >>>>>>> Remote [obsync-conflict-marker]"]);
	});


	it("redraws a marker line whose text or classes changed, and only then", () => {
		const decorations = field();
		/** The block widget shown for line `line` (from 0) of `doc`. */
		const markerOf = (doc: string, line: number) => {
			const state = stateOf(doc, decorations);
			let found: WidgetType | undefined;
			state.field(decorations).between(0, state.doc.length, (from, to, decoration) => {
				const spec = decoration.spec as { widget?: WidgetType };
				if (to > from && state.doc.lineAt(from).number === line + 1) found = spec.widget;
			});
			if (found === undefined) throw new Error(`no marker line ${line}`);
			return found;
		};
		const block = "<<<<<<< Laptop\nmine\n=======\ntheirs\n>>>>>>> Remote";
		const outer = (inner: string) => `<<<<<<< Phone\n${inner}\n=======\nolder\n>>>>>>> Remote`;
		expect(markerOf(block, 0).eq(markerOf(`${block}\nafter`, 0))).toBe(true);
		expect(markerOf(block, 0).eq(markerOf(block.replace("Laptop", "Tablet"), 0))).toBe(false);
		// Nested in a side, the same marker line takes the outer block's tint.
		expect(markerOf(`\n${block}`, 1).eq(markerOf(outer(block), 1))).toBe(false);
	});

	it("marks no line after a block that ends the note", () => {
		const decorations = field();
		const state = stateOf("<<<<<<< Laptop\nmine\n=======\ntheirs\n>>>>>>> Remote", decorations);
		expect(drawn(state, decorations)[4]).toEqual(["line: >>>>>>> Remote [obsync-conflict-marker]"]);
	});

	it("follows edits: a resolved block loses its decorations, a new one gains them", () => {
		const decorations = field();
		const note = "<<<<<<< Laptop\nmine\n=======\ntheirs\n>>>>>>> Remote\n";
		let state = stateOf(note, decorations);

		state = state.update({ changes: { from: 0, to: note.length, insert: "mine\n" } }).state;
		expect(drawn(state, decorations)).toEqual([[], []]);

		const inserted = "<<<<<<< A\n=======\nb\n>>>>>>> B\n";
		// The cursor after the new block, on "mine".
		state = state.update({ changes: { from: 0, insert: inserted }, selection: { anchor: inserted.length } }).state;
		expect(drawn(state, decorations)).toEqual([
			["actions", "line: <<<<<<< A [obsync-conflict-marker]"],
			["line: ======= [obsync-conflict-marker]"],
			["obsync-conflict-remote"],
			["line: >>>>>>> B [obsync-conflict-marker]"],
			["obsync-conflict-after"],
			[],
		]);
	});

	it("draws a block nested in a side with its own action row, keeping the outer tint", () => {
		const decorations = field();
		const note = [
			"<<<<<<< Phone",
			"<<<<<<< Laptop",
			"mine",
			"=======",
			"theirs",
			">>>>>>> Remote",
			"=======",
			"older",
			">>>>>>> Remote",
		].join("\n");
		const state = stateOf(note, decorations);
		const lines = drawn(state, decorations);
		const sorted = lines.map((classes) => [...classes].sort());
		expect(sorted[0]).toEqual(["actions", "line: <<<<<<< Phone [obsync-conflict-marker]"]);
		// The nested block's markers keep the outer side's tint.
		expect(sorted[1]).toEqual(["actions", "line: <<<<<<< Laptop [obsync-conflict-local obsync-conflict-marker]"]);
		// The outer block's tint stays under the nested block's own.
		expect(sorted[2]).toEqual(["obsync-conflict-local", "obsync-conflict-nested-local"]);
		expect(sorted[4]).toEqual(["obsync-conflict-local", "obsync-conflict-nested-remote"]);
		expect(sorted[5]).toEqual(["line: >>>>>>> Remote [obsync-conflict-local obsync-conflict-marker]"]);
		// The nested block's >>>>>>> quote runs on to the outer block's last lines; a marker line, shown as a block, is no quote.
		expect(sorted[6]).toEqual(["line: ======= [obsync-conflict-marker]"]);
		expect(sorted[7]).toEqual(["obsync-conflict-after", "obsync-conflict-remote"]);
	});
});
