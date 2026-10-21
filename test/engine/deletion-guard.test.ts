import { describe, expect, it } from "vitest";
import {
	DEFAULT_DELETION_GUARD,
	guardReason,
	parseMaxDeletedFiles,
	parseMaxDeletedPercent,
	type DeletionCounts,
} from "../../src/engine/deletion-guard";

/** Counts for a vault of `syncedFiles` synced files, all still on both sides, deleting nothing. */
function counts(syncedFiles: number, changes: Partial<DeletionCounts> = {}): DeletionCounts {
	return { syncedFiles, vaultFiles: syncedFiles, remoteFiles: syncedFiles, toRemote: 0, toVault: 0, ...changes };
}

describe("Deletion guard", () => {
	it("starts at 100 files and 50 %", () => {
		expect(DEFAULT_DELETION_GUARD).toEqual({ maxFiles: 100, maxPercent: 50 });
	});

	it("lets a sync delete exactly N files in either direction, and stops it at one more", () => {
		const settings = { maxFiles: 100, maxPercent: 50 };
		expect(guardReason(counts(1000, { toRemote: 100 }), settings)).toBeNull();
		expect(guardReason(counts(1000, { toVault: 100 }), settings)).toBeNull();
		expect(guardReason(counts(1000, { toRemote: 101 }), settings)).toBe("threshold");
		expect(guardReason(counts(1000, { toVault: 101 }), settings)).toBe("threshold");
	});

	it("lets a sync delete exactly P % of the synced files in either direction, and stops it above", () => {
		const settings = { maxFiles: 100, maxPercent: 50 };
		expect(guardReason(counts(10, { toRemote: 5 }), settings)).toBeNull();
		expect(guardReason(counts(10, { toVault: 5 }), settings)).toBeNull();
		expect(guardReason(counts(10, { toRemote: 6 }), settings)).toBe("threshold");
		expect(guardReason(counts(10, { toVault: 6 }), settings)).toBe("threshold");
	});

	it("compares each direction on its own, not their sum", () => {
		const settings = { maxFiles: 100, maxPercent: 50 };
		expect(guardReason(counts(10, { toRemote: 4, toVault: 4 }), settings)).toBeNull();
	});

	it("takes a share that is not a whole percentage as it is", () => {
		const settings = { maxFiles: 100, maxPercent: 50 };
		// 1 of 3 is 33.3 %, 2 of 3 is 66.7 %.
		expect(guardReason(counts(3, { toVault: 1 }), settings)).toBeNull();
		expect(guardReason(counts(3, { toVault: 2 }), settings)).toBe("threshold");
	});

	it("always stops a sync whose vault has none of its files left, whatever N and P allow", () => {
		const settings = { maxFiles: 100_000, maxPercent: 100 };
		expect(guardReason(counts(3, { vaultFiles: 0, toRemote: 3 }), settings)).toBe("missingVault");
	});

	it("always stops a sync whose Remote has no files left, whatever N and P allow", () => {
		const settings = { maxFiles: 100_000, maxPercent: 100 };
		expect(guardReason(counts(3, { remoteFiles: 0, toVault: 3 }), settings)).toBe("emptyRemote");
	});

	it("does not stop a device that has synced no file yet", () => {
		expect(guardReason(counts(0, { vaultFiles: 0, remoteFiles: 0 }), DEFAULT_DELETION_GUARD)).toBeNull();
		expect(guardReason(counts(0, { vaultFiles: 2, remoteFiles: 0 }), DEFAULT_DELETION_GUARD)).toBeNull();
	});
});

describe("Deletion guard settings", () => {
	it("takes a typed file count from 1 to 100000", () => {
		expect(parseMaxDeletedFiles("1")).toBe(1);
		expect(parseMaxDeletedFiles(" 100000 ")).toBe(100_000);
	});

	it("refuses a typed file count outside 1 to 100000 or not a whole number", () => {
		for (const typed of ["0", "100001", "", "abc", "2.5", "-3", "1e2", "10 files"]) {
			expect(parseMaxDeletedFiles(typed), typed).toBeNull();
		}
	});

	it("takes a typed percentage from 1 to 100", () => {
		expect(parseMaxDeletedPercent("1")).toBe(1);
		expect(parseMaxDeletedPercent(" 100 ")).toBe(100);
	});

	it("refuses a typed percentage outside 1 to 100 or not a whole number", () => {
		for (const typed of ["0", "101", "", "abc", "12.5", "-1", "50%"]) {
			expect(parseMaxDeletedPercent(typed), typed).toBeNull();
		}
	});
});
