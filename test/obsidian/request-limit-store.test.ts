import { describe, expect, it } from "vitest";
import { parseRequestLimit } from "../../src/engine/request-limit";
import { storableRequestLimit, storedRequestLimit } from "../../src/obsidian/request-limit-store";

describe("stored Per-request limit", () => {
	it("reads a missing stored limit as the 16 MiB default", () => {
		expect(storedRequestLimit(null)).toEqual({ mebibytes: 16, bytes: 16_777_216 });
	});

	it("reads back the limit it stored", () => {
		const limit = parseRequestLimit("8");
		expect(limit).not.toBeNull();
		expect(storedRequestLimit(storableRequestLimit(limit!))).toEqual({ mebibytes: 8, bytes: 8_388_608 });
	});

	it("reads a stored limit of another format version, out of range or malformed as the default", () => {
		const stored = [
			{ formatVersion: 2, mebibytes: 8 },
			{ formatVersion: 1, mebibytes: 40 },
			{ formatVersion: 1, mebibytes: "8" },
			{ formatVersion: 1 },
			"8",
			8,
		];
		for (const value of stored) expect(storedRequestLimit(value), JSON.stringify(value)).toMatchObject({ mebibytes: 16 });
	});
});
