import { describe, expect, it } from "vitest";
import { NO_CONFLICTS } from "../../src/engine/conflicts";
import { tabContent } from "../../src/ui/sync-tab-content";
import type { ShownSync } from "../../src/ui/sync-window";

const shown: ShownSync = {
	status: { state: "synced" },
	conflicts: { conflicted: ["note.md"], copies: [], configuration: [] },
	skipped: [{ path: "big.bin", reason: "tooLarge" }],
	activity: [{ at: 1, kind: "status", status: { state: "synced" } }],
};

describe("tabContent", () => {
	it("is the same for equal data in new objects, so a report that changes nothing redraws nothing", () => {
		const again: ShownSync = JSON.parse(JSON.stringify(shown)) as ShownSync;

		for (const tab of ["conflicts", "skipped", "activity"] as const) {
			expect(tabContent(again, tab), tab).toBe(tabContent(shown, tab));
		}
	});

	it("changes when the tab's own data changes", () => {
		expect(tabContent({ ...shown, conflicts: NO_CONFLICTS }, "conflicts")).not.toBe(tabContent(shown, "conflicts"));
		expect(tabContent({ ...shown, skipped: [] }, "skipped")).not.toBe(tabContent(shown, "skipped"));
		expect(tabContent({ ...shown, activity: [] }, "activity")).not.toBe(tabContent(shown, "activity"));
	});

	it("does not change with the status or another tab's data", () => {
		const changed: ShownSync = { status: { state: "syncing" }, conflicts: NO_CONFLICTS, skipped: [], activity: [] };

		expect(tabContent({ ...changed, conflicts: shown.conflicts }, "conflicts")).toBe(tabContent(shown, "conflicts"));
		expect(tabContent({ ...changed, skipped: shown.skipped }, "skipped")).toBe(tabContent(shown, "skipped"));
		expect(tabContent({ ...changed, activity: shown.activity }, "activity")).toBe(tabContent(shown, "activity"));
	});
});
