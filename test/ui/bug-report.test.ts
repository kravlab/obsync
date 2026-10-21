import { describe, expect, it } from "vitest";
import { NO_CONFLICTS } from "../../src/engine/conflicts";
import { bugReport } from "../../src/ui/bug-report";

/** 2026-10-20 14:30 on the test machine's own clock. */
const AFTERNOON = new Date(2026, 9, 20, 14, 30).getTime();

const about = { pluginVersion: "0.1.0", obsidianVersion: "1.11.4", platform: "Android" };

describe("bugReport", () => {
	it("gives the versions, platform, status with counts and every event newest first, in English", () => {
		const report = bugReport({
			...about,
			status: { state: "syncFailed", cause: "quotaExceeded" },
			conflicts: { ...NO_CONFLICTS, conflicted: ["a.md"] },
			skipped: [],
			activity: [
				{ at: AFTERNOON + 60_000, kind: "status", status: { state: "syncFailed", cause: "quotaExceeded" } },
				{ at: AFTERNOON, kind: "notice", notice: { kind: "configurationChanged" } },
			],
		});

		expect(report).toBe(
			[
				"Obsync bug report",
				"Plugin version: 0.1.0",
				"Obsidian version: 1.11.4",
				"Platform: Android",
				"Status: Sync failed · 1 in conflict",
				"Activity, newest first:",
				"2026-10-20 14:31 Sync failed. Dropbox is full.",
				"2026-10-20 14:30 Settings changed on another device. Restart Obsidian to apply them.",
			].join("\n"),
		);
	});

	it("says so when no activity is recorded", () => {
		const report = bugReport({ ...about, status: { state: "synced" }, conflicts: NO_CONFLICTS, skipped: [], activity: [] });

		expect(report.split("\n").slice(-2)).toEqual(["Activity, newest first:", "No activity recorded."]);
	});
});
