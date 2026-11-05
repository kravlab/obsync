import { describe, expect, it } from "vitest";
import { conflictCount, conflictsOf, holdsConflictBlocks } from "../../src/engine/conflicts";
import type { SnapshotEntry } from "../../src/engine/sync-snapshot";

/** A synced file's snapshot entry, marked as holding Conflict blocks when `conflicted`. */
function file(conflicted = false): SnapshotEntry {
	return { kind: "file", revision: "r", hash: "h", ...(conflicted ? { conflicted: true as const } : {}) };
}

const kept = { id: "kept-1", path: ".vault-config/app.json", keptAt: 5 };

describe("conflictsOf", () => {
	it("lists marked files and Conflict copies ordered by path, with the kept versions as given", () => {
		const snapshot = new Map<string, SnapshotEntry>([
			["b.md", file(true)],
			["a.md", file(true)],
			["clean.md", file()],
			["Photo (conflict Phone 2026-10-20 1430).png", file()],
			["folder", { kind: "folder" }],
		]);

		expect(conflictsOf(snapshot, [kept])).toEqual({
			conflicted: ["a.md", "b.md"],
			copies: ["Photo (conflict Phone 2026-10-20 1430).png"],
			configuration: [kept],
		});
	});

	it("lists a Conflict copy that holds Conflict blocks under both", () => {
		const copy = "Note (conflict Phone 2026-10-20 1430).md";

		expect(conflictsOf(new Map([[copy, file(true)]]), [])).toEqual({ conflicted: [copy], copies: [copy], configuration: [] });
	});
});

describe("conflictCount", () => {
	it("adds up the three lists", () => {
		expect(
			conflictCount({ conflicted: ["a.md", "b.md"], copies: ["c (conflict P 2026-10-20 1430).png"], configuration: [kept] }),
		).toBe(4);
	});
});

describe("holdsConflictBlocks", () => {
	it("finds a complete Conflict block", () => {
		expect(holdsConflictBlocks("a\n<<<<<<< Phone\nx\n=======\ny\n>>>>>>> Remote\n")).toBe(true);
	});

	it("ignores text without one, or with markers that do not close", () => {
		expect(holdsConflictBlocks("plain\n")).toBe(false);
		expect(holdsConflictBlocks("<<<<<<< Phone\nx\n")).toBe(false);
	});
});
