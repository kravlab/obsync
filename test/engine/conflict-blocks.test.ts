import { describe, expect, it } from "vitest";
import {
	adjacentBlock,
	conflictBlocks,
	findBlock,
	resolutionOf,
	sectionPieces,
	type ConflictAction,
	type ConflictBlock,
} from "../../src/engine/conflict-blocks";

describe("finding Conflict blocks", () => {
	it("finds a block with its labels, its two sides and its lines", () => {
		const note = "title\n<<<<<<< Laptop\nmine\n=======\ntheirs\nmore\n>>>>>>> Remote\nend\n";
		expect(conflictBlocks(note)).toEqual([
			{
				startLine: 1,
				separatorLine: 3,
				endLine: 6,
				localLabel: "Laptop",
				remoteLabel: "Remote",
				local: "mine\n",
				remote: "theirs\nmore\n",
			},
		]);
	});
});

describe("finding nested and malformed Conflict blocks", () => {
	it("finds a block nested in a side, and the block around it", () => {
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
			"",
		].join("\n");
		expect(conflictBlocks(note).map(({ startLine, separatorLine, endLine }) => [startLine, separatorLine, endLine])).toEqual([
			[0, 6, 8],
			[1, 3, 5],
		]);
		expect(conflictBlocks(note)[0]?.local).toBe("<<<<<<< Laptop\nmine\n=======\ntheirs\n>>>>>>> Remote\n");
	});

	it("takes markers that complete no block as plain text", () => {
		expect(conflictBlocks("<<<<<<< A\nx\n>>>>>>> B\n")).toEqual([]);
		expect(conflictBlocks("<<<<<<< A\nx\n=======\ny\n")).toEqual([]);
		expect(conflictBlocks("=======\n>>>>>>> B\n")).toEqual([]);
		expect(conflictBlocks("<<<<<<<< eight\nx\n=======\ny\n>>>>>>> B\n")).toEqual([]);
		expect(conflictBlocks("<<<<<<<A\nx\n=======\ny\n>>>>>>> B\n")).toEqual([]);
		const extraSeparator = conflictBlocks("<<<<<<< A\nx\n=======\ny\n=======\nz\n>>>>>>> B\n");
		expect(extraSeparator).toEqual([expect.objectContaining({ local: "x\n", remote: "y\n=======\nz\n" })]);
	});

	it("keeps a stray opener in the block's remote side as plain text", () => {
		expect(conflictBlocks("<<<<<<< A\nx\n=======\n<<<<<<< stray\ny\n>>>>>>> B\n")).toEqual([
			{
				startLine: 0,
				separatorLine: 2,
				endLine: 5,
				localLabel: "A",
				remoteLabel: "B",
				local: "x\n",
				remote: "<<<<<<< stray\ny\n",
			},
		]);
	});

	it("keeps a stray opener in the block's local side as plain text", () => {
		expect(conflictBlocks("<<<<<<< A\n<<<<<<< stray\nx\n=======\ny\n>>>>>>> B\n")).toEqual([
			{
				startLine: 0,
				separatorLine: 3,
				endLine: 5,
				localLabel: "A",
				remoteLabel: "B",
				local: "<<<<<<< stray\nx\n",
				remote: "y\n",
			},
		]);
	});

	it("finds a block whose markers have no labels, or CRLF line breaks", () => {
		expect(conflictBlocks("<<<<<<<\nx\n=======\ny\n>>>>>>>\n")).toEqual([
			expect.objectContaining({ localLabel: "", remoteLabel: "", local: "x\n", remote: "y\n" }),
		]);
		expect(conflictBlocks("<<<<<<< A\r\nx\r\n=======\r\ny\r\n>>>>>>> B\r\n")).toEqual([
			expect.objectContaining({ localLabel: "A", remoteLabel: "B", local: "x\r\n", remote: "y\r\n" }),
		]);
	});
});

describe("resolving a Conflict block", () => {
	const note = "title\n<<<<<<< Laptop\nmine\n=======\ntheirs\n>>>>>>> Remote\nend\n";

	/** `text` after the edit that `action` makes to its block numbered `which`, the first by default. */
	function resolved(text: string, action: ConflictAction, which = 0): string {
		const block = conflictBlocks(text)[which];
		if (block === undefined) throw new Error("no such block");
		const edit = resolutionOf(text, block, action);
		return text.slice(0, edit.from) + edit.insert + text.slice(edit.to);
	}

	it("keeps this device's side, the other's, or both in order, markers removed", () => {
		expect(resolved(note, { kind: "keepLocal" })).toBe("title\nmine\nend\n");
		expect(resolved(note, { kind: "keepRemote" })).toBe("title\ntheirs\nend\n");
		expect(resolved(note, { kind: "keepBoth" })).toBe("title\nmine\ntheirs\nend\n");
	});

	it("replaces the block with a hand edit, ending it with a line break as the block was", () => {
		expect(resolved(note, { kind: "replace", text: "combined" })).toBe("title\ncombined\nend\n");
		expect(resolved(note, { kind: "replace", text: "combined\n" })).toBe("title\ncombined\nend\n");
		expect(resolved(note, { kind: "replace", text: "" })).toBe("title\nend\n");
	});

	it("leaves no line break behind a block that ended the note without one", () => {
		const atEnd = "<<<<<<< Laptop\nmine\n=======\ntheirs\n>>>>>>> Remote";
		expect(resolved(atEnd, { kind: "keepLocal" })).toBe("mine");
		expect(resolved(atEnd, { kind: "keepBoth" })).toBe("mine\ntheirs");
		expect(resolved(atEnd, { kind: "replace", text: "combined" })).toBe("combined");
	});

	it("resolves a block with an empty side", () => {
		const emptyLocal = "<<<<<<< Laptop\n=======\ntheirs\n>>>>>>> Remote\nend\n";
		expect(resolved(emptyLocal, { kind: "keepLocal" })).toBe("end\n");
		expect(resolved(emptyLocal, { kind: "keepBoth" })).toBe("theirs\nend\n");
	});

	it("resolves a block with CRLF line breaks, keeping them", () => {
		const crlf = "a\r\n<<<<<<< Laptop\r\nmine\r\n=======\r\ntheirs\r\n>>>>>>> Remote\r\nb\r\n";
		expect(resolved(crlf, { kind: "keepRemote" })).toBe("a\r\ntheirs\r\nb\r\n");
		expect(resolved(crlf, { kind: "keepBoth" })).toBe("a\r\nmine\r\ntheirs\r\nb\r\n");
	});

	it("resolves an inner block alone, and an outer one with the inner block kept in its side", () => {
		const nested = "<<<<<<< Phone\n<<<<<<< Laptop\nmine\n=======\ntheirs\n>>>>>>> Remote\n=======\nolder\n>>>>>>> Remote\n";
		expect(resolved(nested, { kind: "keepRemote" }, 1)).toBe("<<<<<<< Phone\ntheirs\n=======\nolder\n>>>>>>> Remote\n");
		expect(resolved(nested, { kind: "keepRemote" }, 0)).toBe("older\n");
		expect(resolved(nested, { kind: "keepLocal" }, 0)).toBe("<<<<<<< Laptop\nmine\n=======\ntheirs\n>>>>>>> Remote\n");
	});
});

describe("moving between Conflict blocks", () => {
	const block = (startLine: number) => ({ startLine }) as ConflictBlock;
	const blocks = [block(2), block(10), block(20)];

	it("finds the next block after a line, wrapping from the last to the first", () => {
		expect(adjacentBlock(blocks, 0, "next")?.startLine).toBe(2);
		expect(adjacentBlock(blocks, 2, "next")?.startLine).toBe(10);
		expect(adjacentBlock(blocks, 15, "next")?.startLine).toBe(20);
		expect(adjacentBlock(blocks, 20, "next")?.startLine).toBe(2);
	});

	it("finds the previous block before a line, wrapping from the first to the last", () => {
		expect(adjacentBlock(blocks, 25, "previous")?.startLine).toBe(20);
		expect(adjacentBlock(blocks, 10, "previous")?.startLine).toBe(2);
		expect(adjacentBlock(blocks, 2, "previous")?.startLine).toBe(20);
	});

	it("finds none in a note without blocks", () => {
		expect(adjacentBlock([], 3, "next")).toBeNull();
	});
});

describe("splitting a section of a note around Conflict blocks", () => {
	const note = ["intro", "<<<<<<< Laptop", "mine", "", "more", "=======", "theirs", ">>>>>>> Remote", "after", "", "next"].join("\n");

	it("splits a section into its text and the blocks starting in it", () => {
		expect(sectionPieces(note, 0, 3)).toEqual([
			{ kind: "text", text: "intro\n" },
			{ kind: "block", block: expect.objectContaining({ startLine: 1, endLine: 7 }) as unknown },
		]);
	});

	it("drops the lines of a block that started in an earlier section, keeping the text after it", () => {
		expect(sectionPieces(note, 4, 8)).toEqual([{ kind: "text", text: "after\n" }]);
	});

	it("leaves a section that no block touches alone", () => {
		expect(sectionPieces(note, 10, 10)).toBeNull();
	});

	it("shows a nested block only as part of the block around it", () => {
		const nested = "<<<<<<< Phone\n<<<<<<< Laptop\nmine\n=======\ntheirs\n>>>>>>> Remote\n=======\nolder\n>>>>>>> Remote\n";
		expect(sectionPieces(nested, 0, 8)).toEqual([
			{ kind: "block", block: expect.objectContaining({ startLine: 0, endLine: 8 }) as unknown },
		]);
	});
});

describe("finding a Conflict block again", () => {
	const twin = "<<<<<<< Laptop\nmine\n=======\ntheirs\n>>>>>>> Remote\n";

	it("finds the block that was shown, at its own place, among identical ones", () => {
		const note = `${twin}between\n${twin}`;
		const second = conflictBlocks(note)[1];
		if (second === undefined) throw new Error("no second block");
		expect(findBlock(note, second)?.startLine).toBe(6);
	});

	it("finds nothing once the block changed or moved", () => {
		const shown = conflictBlocks(twin)[0];
		if (shown === undefined) throw new Error("no block");
		expect(findBlock(twin.replace("theirs", "edited"), shown)).toBeNull();
		expect(findBlock(`new line\n${twin}`, shown)).toBeNull();
		expect(findBlock("mine\n", shown)).toBeNull();
	});
});
