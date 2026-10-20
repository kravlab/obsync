import { describe, expect, it } from "vitest";
import {
	DEFAULT_EDIT_PAUSE,
	DEFAULT_POLL_INTERVAL,
	DEFAULT_SYNC_SCHEDULE,
	parseEditPause,
	parsePollInterval,
} from "../../src/engine/sync-schedule";

describe("sync schedule settings", () => {
	it("starts with a 2 s post-edit pause and a 60 s polling interval", () => {
		expect(DEFAULT_EDIT_PAUSE).toEqual({ seconds: 2, ms: 2000 });
		expect(DEFAULT_POLL_INTERVAL).toEqual({ seconds: 60, ms: 60_000 });
		expect(DEFAULT_SYNC_SCHEDULE).toEqual({ editPause: DEFAULT_EDIT_PAUSE, pollInterval: DEFAULT_POLL_INTERVAL });
	});

	it("takes a typed post-edit pause in whole seconds from 1 to 60", () => {
		expect(parseEditPause("1")).toEqual({ seconds: 1, ms: 1000 });
		expect(parseEditPause(" 60 ")).toEqual({ seconds: 60, ms: 60_000 });
	});

	it("refuses a typed post-edit pause outside 1 to 60 s or not a whole number", () => {
		for (const typed of ["0", "61", "", "abc", "1.5", "-2", "2s"]) {
			expect(parseEditPause(typed), typed).toBeNull();
		}
	});

	it("takes a typed polling interval in whole seconds from 10 to 3600", () => {
		expect(parsePollInterval("10")).toEqual({ seconds: 10, ms: 10_000 });
		expect(parsePollInterval(" 3600 ")).toEqual({ seconds: 3600, ms: 3_600_000 });
	});

	it("refuses a typed polling interval outside 10 to 3600 s or not a whole number", () => {
		for (const typed of ["9", "3601", "0", "", "abc", "30.5", "-10", "60s"]) {
			expect(parsePollInterval(typed), typed).toBeNull();
		}
	});
});
