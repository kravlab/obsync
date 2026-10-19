import { describe, expect, it } from "vitest";
import { parentOf } from "./paths";

describe("parentOf", () => {
	it("gives the folder holding a nested path", () => {
		expect(parentOf("notes/daily/today.md")).toBe("notes/daily");
	});

	it("gives the top for a path with no folder", () => {
		expect(parentOf("note.md")).toBe("");
	});
});
