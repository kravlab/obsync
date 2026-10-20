import { describe, expect, it } from "vitest";
import { parseEditPause, parsePollInterval } from "../../src/engine/sync-schedule";
import { storableSyncSchedule, storedSyncSchedule } from "../../src/obsidian/schedule-store";

describe("stored sync schedule", () => {
	it("reads a missing stored schedule as the 2 s and 60 s defaults", () => {
		expect(storedSyncSchedule(null)).toEqual({
			editPause: { seconds: 2, ms: 2_000 },
			pollInterval: { seconds: 60, ms: 60_000 },
		});
	});

	it("reads back the schedule it stored", () => {
		const editPause = parseEditPause("5")!;
		const pollInterval = parsePollInterval("120")!;
		expect(storedSyncSchedule(storableSyncSchedule({ editPause, pollInterval }))).toEqual({
			editPause: { seconds: 5, ms: 5_000 },
			pollInterval: { seconds: 120, ms: 120_000 },
		});
	});

	it("reads a stored schedule of another format version, out of range or malformed as the defaults", () => {
		const stored = [
			{ formatVersion: 2, editPauseSeconds: 5, pollIntervalSeconds: 120 },
			{ formatVersion: 1, editPauseSeconds: 0, pollIntervalSeconds: 60 },
			{ formatVersion: 1, editPauseSeconds: 2, pollIntervalSeconds: 5 },
			{ formatVersion: 1, editPauseSeconds: "5", pollIntervalSeconds: 120 },
			{ formatVersion: 1 },
			"5",
		];
		for (const value of stored) {
			expect(storedSyncSchedule(value), JSON.stringify(value)).toEqual({
				editPause: { seconds: 2, ms: 2_000 },
				pollInterval: { seconds: 60, ms: 60_000 },
			});
		}
	});
});
