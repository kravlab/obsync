import { describe, expect, it } from "vitest";
import { storableDeletionGuard, storedDeletionGuard } from "../../src/obsidian/deletion-guard-store";

describe("stored Deletion guard settings", () => {
	it("reads missing stored settings as the 100 files and 50 % defaults", () => {
		expect(storedDeletionGuard(null)).toEqual({ maxFiles: 100, maxPercent: 50 });
	});

	it("reads back the settings it stored", () => {
		expect(storedDeletionGuard(storableDeletionGuard({ maxFiles: 20, maxPercent: 10 }))).toEqual({
			maxFiles: 20,
			maxPercent: 10,
		});
	});

	it("reads stored settings of another format version, out of range or malformed as the defaults", () => {
		const stored = [
			{ formatVersion: 2, maxFiles: 20, maxPercent: 10 },
			{ formatVersion: 1, maxFiles: 0, maxPercent: 10 },
			{ formatVersion: 1, maxFiles: 20, maxPercent: 101 },
			{ formatVersion: 1, maxFiles: "20", maxPercent: 10 },
			{ formatVersion: 1 },
			"20",
		];
		for (const value of stored) {
			expect(storedDeletionGuard(value), JSON.stringify(value)).toEqual({ maxFiles: 100, maxPercent: 50 });
		}
	});
});
