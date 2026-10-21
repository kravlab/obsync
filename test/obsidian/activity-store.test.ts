import { describe, expect, it } from "vitest";
import type { ActivityEvent } from "../../src/engine/activity-log";
import { storableActivity, storedActivity } from "../../src/obsidian/activity-store";

const events: ActivityEvent[] = [
	{ at: 2_000, kind: "notice", notice: { kind: "conflictCopyCreated", path: "a.png", copyPath: "a (conflict P 2026-10-20 1430).png" } },
	{ at: 1_000, kind: "status", status: { state: "syncFailed", cause: "permanent" } },
];

describe("stored activity log", () => {
	it("reads back the events it stored, in their order", () => {
		expect(storedActivity(storableActivity(events))).toEqual(events);
	});

	it("reads a missing record, another format version or a record that is not a list as no events", () => {
		for (const value of [null, { formatVersion: 2, events }, { formatVersion: 1, events: "x" }, "x"]) {
			expect(storedActivity(value), JSON.stringify(value)).toEqual([]);
		}
	});

	it("leaves out stored events that are malformed, keeping the others", () => {
		const stored = {
			formatVersion: 1,
			events: [
				events[0],
				{ at: "soon", kind: "status", status: { state: "synced" } },
				{ at: 5, kind: "notice", notice: "configurationChanged" },
				{ at: 5, kind: "status", status: { state: 3 } },
				{ at: 5, kind: "other" },
				events[1],
			],
		};

		expect(storedActivity(stored)).toEqual(events);
	});

	it("reads back an event of every status state and notice kind", () => {
		const every: ActivityEvent[] = [
			...(["notConnected", "connected", "synced", "offline", "reconnectNeeded", "deletionsOnHold", "firstSyncWaiting"] as const).map(
				(state): ActivityEvent => ({ at: 1, kind: "status", status: { state } }),
			),
			{ at: 1, kind: "status", status: { state: "syncFailed", cause: "bug" } },
			{ at: 1, kind: "notice", notice: { kind: "restoredAfterDelete", path: "a.md", deletedOn: "thisDevice" } },
			{ at: 1, kind: "notice", notice: { kind: "renamedOnBoth", path: "b.md", localPath: "c.md" } },
			{ at: 1, kind: "notice", notice: { kind: "renameBeatsDelete", path: "d.md", deletedOn: "otherDevice" } },
			{
				at: 1,
				kind: "notice",
				notice: { kind: "firstSyncDone", downloaded: 1, uploaded: 2, conflicted: 0, conflictCopies: 3 },
			},
			{ at: 1, kind: "notice", notice: { kind: "configurationChanged" } },
			{ at: 1, kind: "notice", notice: { kind: "reconnectNeeded" } },
		];

		expect(storedActivity(storableActivity(every))).toEqual(every);
	});

	it.each([
		["an unknown state", { state: "paused" }],
		["a failure without its cause", { state: "syncFailed" }],
		["a failure with an unknown cause", { state: "syncFailed", cause: "gremlins" }],
	])("leaves out a status with %s", (_, status) => {
		expect(storedActivity({ formatVersion: 1, events: [{ at: 5, kind: "status", status }] })).toEqual([]);
	});

	it.each([
		["an unknown kind", { kind: "somethingHappened" }],
		["a Conflict copy without its copy's path", { kind: "conflictCopyCreated", path: "a.png" }],
		["a restore with an unknown side", { kind: "restoredAfterDelete", path: "a.md", deletedOn: "elsewhere" }],
		["a rename without this device's name", { kind: "renamedOnBoth", path: "b.md" }],
		["a rename over a delete without its path", { kind: "renameBeatsDelete", deletedOn: "thisDevice" }],
		["a First sync with a count that is not a number", { kind: "firstSyncDone", downloaded: "1", uploaded: 2, conflicted: 0, conflictCopies: 0 }],
	])("leaves out a notice with %s", (_, notice) => {
		expect(storedActivity({ formatVersion: 1, events: [{ at: 5, kind: "notice", notice }] })).toEqual([]);
	});
});
