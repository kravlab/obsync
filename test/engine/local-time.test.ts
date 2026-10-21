import { describe, expect, it } from "vitest";
import { localDateTime } from "../../src/engine/local-time";

describe("localDateTime", () => {
	it("gives the local day, hours and minutes, each padded to its width", () => {
		expect(localDateTime(new Date(2026, 0, 5, 9, 7).getTime())).toEqual({ day: "2026-01-05", hours: "09", minutes: "07" });
		expect(localDateTime(new Date(2026, 9, 20, 14, 30).getTime())).toEqual({ day: "2026-10-20", hours: "14", minutes: "30" });
	});
});
