import { describe, expect, it } from "vitest";
import { mergeText } from "../../src/engine/text-merge";
import { bytes } from "../support/bytes";

/** The labels of a merge on the device "Laptop". */
const LABELS = { local: "Laptop", remote: "Remote" } as const;

/** Merges the texts as `mergeText` merges bytes; fails if any is not text. */
function merge(base: string | null, local: string, remote: string): string {
	const merged = mergeText(
		{ base: base === null ? null : bytes(base), local: bytes(local), remote: bytes(remote) },
		LABELS,
	);
	if (merged === null) throw new Error("not merged as text");
	// ignoreBOM keeps a byte-order mark in the text, where the tests can see it.
	return new TextDecoder("utf-8", { ignoreBOM: true }).decode(merged);
}

describe("text merge with a Base", () => {
	it("merges edits to different lines without a Conflict block", () => {
		expect(merge("one\ntwo\nthree\n", "ONE\ntwo\nthree\n", "one\ntwo\nTHREE\n")).toBe("ONE\ntwo\nTHREE\n");
	});

	it("writes overlapping edits as a git-style Conflict block, this device's side first", () => {
		expect(merge("one\ntwo\nthree\n", "one\nmine\nthree\n", "one\ntheirs\nthree\n")).toBe("one\n<<<<<<< Laptop\nmine\n=======\ntheirs\n>>>>>>> Remote\nthree\n");
	});

	it("takes the same edit made on both sides as no conflict", () => {
		expect(merge("one\ntwo\n", "one\nsame\n", "one\nsame\n")).toBe("one\nsame\n");
	});

	it("closes a side that ends without a line break before the next marker", () => {
		expect(merge("one\ntwo", "one\nmine", "one\ntheirs")).toBe("one\n<<<<<<< Laptop\nmine\n=======\ntheirs\n>>>>>>> Remote\n");
	});
});

describe("text merge without a Base", () => {
	it("keeps common lines once and makes every differing region a Conflict block, picking no side", () => {
		expect(merge(null, "title\nmine\nmiddle\nend\n", "title\ntheirs\nmiddle\nend\nadded\n")).toBe("title\n<<<<<<< Laptop\nmine\n=======\ntheirs\n>>>>>>> Remote\nmiddle\nend\n" +
				"<<<<<<< Laptop\n=======\nadded\n>>>>>>> Remote\n");
	});

	it("takes identical versions as no conflict", () => {
		expect(merge(null, "same\ntext\n", "same\ntext\n")).toBe("same\ntext\n");
	});
});

describe("text merge line endings and BOM", () => {
	it("takes a difference only in line endings as none, and writes the result with the local line endings", () => {
		expect(merge("a\nb\n", "a\r\nb\r\n", "a\nB\n")).toBe("a\r\nB\r\n");
		expect(merge(null, "a\r\nb\r\n", "a\nb\n")).toBe("a\r\nb\r\n");
	});

	it("writes a Conflict block's markers with the local line endings too", () => {
		expect(merge("a\nb\n", "a\r\nmine\r\n", "a\ntheirs\n")).toBe("a\r\n<<<<<<< Laptop\r\nmine\r\n=======\r\ntheirs\r\n>>>>>>> Remote\r\n");
	});

	it("takes a byte-order mark as no difference, keeping the local file's", () => {
		expect(merge("a\nb\n", "\uFEFFa\nb\n", "a\nb\nc\n")).toBe("\uFEFFa\nb\nc\n");
		expect(merge("a\n", "a\n", "\uFEFFa\nb\n")).toBe("a\nb\n");
	});
});

describe("text merge of what is not text", () => {
	it("merges nothing when any version, the Base included, is not UTF-8", () => {
		const invalid = new Uint8Array([0x61, 0xff, 0xfe, 0x0a]).buffer;
		expect(mergeText({ base: bytes("a\n"), local: invalid, remote: bytes("b\n") }, LABELS)).toBeNull();
		expect(mergeText({ base: bytes("a\n"), local: bytes("b\n"), remote: invalid }, LABELS)).toBeNull();
		expect(mergeText({ base: invalid, local: bytes("b\n"), remote: bytes("c\n") }, LABELS)).toBeNull();
	});
});

describe("text merge of a note with old markers", () => {
	it("merges old markers as plain lines, nesting a new Conflict block where needed", () => {
		const old = "<<<<<<< Phone\nx\n=======\ny\n>>>>>>> Remote\n";
		expect(merge(old, `${old}added\n`, old.replace("x\n", "X\n"))).toBe("<<<<<<< Phone\nX\n=======\ny\n>>>>>>> Remote\nadded\n");
		expect(merge(old, old.replace("x\n", "mine\n"), old.replace("x\n", "theirs\n"))).toBe("<<<<<<< Phone\n<<<<<<< Laptop\nmine\n=======\ntheirs\n>>>>>>> Remote\n=======\ny\n>>>>>>> Remote\n");
	});
});

describe("text merge of a long note", () => {
	/** The lines of a long note, each different. */
	const note = (length: number): string[] => Array.from({ length }, (_, index) => `line ${index}\n`);

	/** Merges and returns the result with how long the merge took, in ms. */
	function timed(base: string[], local: string[], remote: string[]): { text: string; ms: number } {
		const started = performance.now();
		const text = merge(base.join(""), local.join(""), remote.join(""));
		return { text, ms: performance.now() - started };
	}

	it("merges edits at both ends of a 5,000-line note within a second", () => {
		const base = note(5_000);
		const merged = timed(
			base,
			base.map((line, index) => (index === 10 ? "mine\n" : line)),
			base.map((line, index) => (index === 4_990 ? "theirs\n" : line)),
		);
		expect(merged.text).not.toContain("<<<<<<<");
		expect(merged.text.split("\n")[10]).toBe("mine");
		expect(merged.text.split("\n")[4_990]).toBe("theirs");
		expect(merged.ms).toBeLessThan(1000);
	});

	it("merges nearby edits in a 20,000-line note within a second", () => {
		const base = note(20_000);
		const merged = timed(
			base,
			base.map((line, index) => (index === 10_000 ? "mine\n" : line)),
			base.map((line, index) => (index === 10_050 ? "theirs\n" : line)),
		);
		expect(merged.text).not.toContain("<<<<<<<");
		expect(merged.text.split("\n")[10_000]).toBe("mine");
		expect(merged.text.split("\n")[10_050]).toBe("theirs");
		expect(merged.text.split("\n")).toHaveLength(20_001);
		expect(merged.ms).toBeLessThan(1000);
	});
});
