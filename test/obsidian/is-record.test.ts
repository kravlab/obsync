import { describe, expect, it } from "vitest";
import { isRecord } from "../../src/obsidian/is-record";

describe("isRecord", () => {
	it("accepts objects and lists, whose fields can be read", () => {
		expect(isRecord({})).toBe(true);
		expect(isRecord([])).toBe(true);
	});

	it("refuses null and values that are not objects", () => {
		for (const value of [null, undefined, "x", 3, true]) expect(isRecord(value), String(value)).toBe(false);
	});
});
