import { EditorState, type StateField } from "@codemirror/state";
import type { DecorationSet } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { conflictDecorations } from "../../src/ui/conflict-decorations";
import { selectStrings } from "../../src/ui/i18n/strings";

/** A state field over the English strings that never opens a dialog. */
function field(): StateField<DecorationSet> {
	return conflictDecorations({ strings: selectStrings("en"), isPhone: false, editBlock: () => undefined });
}

/** What the field draws on each line of `state`: line classes, and "actions" for an action row before it. */
function drawn(state: EditorState, decorations: StateField<DecorationSet>): string[][] {
	const byLine: string[][] = Array.from({ length: state.doc.lines }, () => []);
	state.field(decorations).between(0, state.doc.length, (from, _to, decoration) => {
		const line = state.doc.lineAt(from).number - 1;
		const spec = decoration.spec as { class?: string; widget?: unknown };
		byLine[line]?.push(spec.widget === undefined ? (spec.class ?? "?") : "actions");
	});
	return byLine;
}

describe("Conflict blocks in the editor", () => {
	it("tints each side, marks the marker lines, and puts an action row before the block", () => {
		const decorations = field();
		const state = EditorState.create({
			doc: "title\n<<<<<<< Laptop\nmine\n=======\ntheirs\n>>>>>>> Remote\nend",
			extensions: [decorations],
		});
		expect(drawn(state, decorations)).toEqual([
			[],
			["actions", "obsync-conflict-marker"],
			["obsync-conflict-local"],
			["obsync-conflict-marker"],
			["obsync-conflict-remote"],
			["obsync-conflict-marker"],
			[],
		]);
	});

	it("follows edits: a resolved block loses its decorations, a new one gains them", () => {
		const decorations = field();
		const note = "<<<<<<< Laptop\nmine\n=======\ntheirs\n>>>>>>> Remote\n";
		let state = EditorState.create({ doc: note, extensions: [decorations] });

		state = state.update({ changes: { from: 0, to: note.length, insert: "mine\n" } }).state;
		expect(drawn(state, decorations)).toEqual([[], []]);

		state = state.update({ changes: { from: 0, insert: "<<<<<<< A\n=======\nb\n>>>>>>> B\n" } }).state;
		expect(drawn(state, decorations)).toEqual([
			["actions", "obsync-conflict-marker"],
			["obsync-conflict-marker"],
			["obsync-conflict-remote"],
			["obsync-conflict-marker"],
			[],
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
		const state = EditorState.create({ doc: note, extensions: [decorations] });
		const lines = drawn(state, decorations);
		const sorted = lines.map((classes) => [...classes].sort());
		expect(sorted[0]).toEqual(["actions", "obsync-conflict-marker"]);
		expect(sorted[1]).toEqual(["actions", "obsync-conflict-local", "obsync-conflict-marker"]);
		// The outer block's tint stays under the nested block's own.
		expect(sorted[2]).toEqual(["obsync-conflict-local", "obsync-conflict-nested-local"]);
		expect(sorted[4]).toEqual(["obsync-conflict-local", "obsync-conflict-nested-remote"]);
		expect(sorted[7]).toEqual(["obsync-conflict-remote"]);
	});
});
