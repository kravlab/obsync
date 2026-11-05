import { describe, expect, it } from "vitest";
import { ACTIVITY_LIMIT, withActivityLog, type ActivityEvent, type ActivityStore } from "../../src/engine/activity-log";
import { ManualClock } from "../fakes/manual-clock";
import { RecordingUi } from "../fakes/test-device";

/** An activity store in memory, as a device keeps it between restarts. */
class InMemoryActivityStore implements ActivityStore {
	/** The events stored last, newest first. */
	events: readonly ActivityEvent[] = [];

	load(): readonly ActivityEvent[] {
		return this.events;
	}

	save(events: readonly ActivityEvent[]): void {
		this.events = events;
	}
}

/** A logging UI port over a recording one, with its store and clock. */
function loggedUi(store = new InMemoryActivityStore()) {
	const clock = new ManualClock();
	const inner = new RecordingUi();
	return { clock, inner, store, ui: withActivityLog(inner, store, clock) };
}

describe("the activity log", () => {
	it("keeps every notice with its time, newest first, and still shows it", () => {
		const { clock, inner, store, ui } = loggedUi();
		ui.showNotice({ kind: "configurationChanged" });
		clock.advance(1_000);
		ui.showNotice({ kind: "reconnectNeeded" });

		const expected: ActivityEvent[] = [
			{ at: 1_000, kind: "notice", notice: { kind: "reconnectNeeded" } },
			{ at: 0, kind: "notice", notice: { kind: "configurationChanged" } },
		];
		expect(inner.lastActivity).toEqual(expected);
		expect(store.events).toEqual(expected);
		expect(inner.notices).toEqual([{ kind: "configurationChanged" }, { kind: "reconnectNeeded" }]);
	});

	it("keeps a status only when it changes, and never Syncing…, while every status is still shown", () => {
		const { inner, ui } = loggedUi();
		for (const status of [
			{ state: "connected" },
			{ state: "syncing" },
			{ state: "synced" },
			{ state: "syncing" },
			{ state: "synced" },
			{ state: "syncing" },
			{ state: "syncFailed", cause: "permanent" },
			{ state: "syncFailed", cause: "quotaExceeded" },
		] as const) {
			ui.showStatus(status);
		}

		expect(inner.lastActivity?.map((event) => event.kind === "status" && event.status)).toEqual([
			{ state: "syncFailed", cause: "quotaExceeded" },
			{ state: "syncFailed", cause: "permanent" },
			{ state: "synced" },
			{ state: "connected" },
		]);
		expect(inner.statuses).toHaveLength(8);
	});

	it("keeps a failure again when only its detail changed, and once when the detail is the same", () => {
		const { inner, ui } = loggedUi();
		for (const status of [
			{ state: "syncFailed", cause: "permanent", detail: "HTTP 400: one" },
			{ state: "syncFailed", cause: "permanent", detail: "HTTP 400: one" },
			{ state: "syncFailed", cause: "permanent", detail: "HTTP 403: two" },
			{ state: "syncFailed", cause: "permanent" },
		] as const) {
			ui.showStatus(status);
		}

		expect(inner.lastActivity?.map((event) => event.kind === "status" && event.status)).toEqual([
			{ state: "syncFailed", cause: "permanent" },
			{ state: "syncFailed", cause: "permanent", detail: "HTTP 403: two" },
			{ state: "syncFailed", cause: "permanent", detail: "HTTP 400: one" },
		]);
	});

	it("keeps a failure while connecting, with its detail, without a notice", () => {
		const { clock, inner, store, ui } = loggedUi();
		clock.advance(5_000);
		ui.reportConnectFailure({ cause: "permanent", detail: "HTTP 400: bad client_id" });

		const expected: ActivityEvent[] = [{ at: 5_000, kind: "connectFailed", cause: "permanent", detail: "HTTP 400: bad client_id" }];
		expect(inner.lastActivity).toEqual(expected);
		expect(store.events).toEqual(expected);
		expect(inner.notices).toEqual([]);
		expect(inner.connectFailures).toEqual([]);
	});

	it("keeps a revoke that failed on disconnect, with its detail, without a notice", () => {
		const { clock, inner, store, ui } = loggedUi();
		clock.advance(7_000);
		ui.reportRevokeFailure({ cause: "transient", detail: "no response" });

		const expected: ActivityEvent[] = [{ at: 7_000, kind: "revokeFailed", cause: "transient", detail: "no response" }];
		expect(inner.lastActivity).toEqual(expected);
		expect(store.events).toEqual(expected);
		expect(inner.notices).toEqual([]);
		expect(inner.revokeFailures).toEqual([]);
	});

	it("keeps only the newest events up to its limit", () => {
		const { clock, inner, ui } = loggedUi();
		for (let index = 0; index < ACTIVITY_LIMIT + 5; index += 1) {
			clock.advance(1);
			ui.showNotice({ kind: "configurationChanged" });
		}

		expect(inner.lastActivity).toHaveLength(ACTIVITY_LIMIT);
		expect(inner.lastActivity?.[0]?.at).toBe(ACTIVITY_LIMIT + 5);
		expect(inner.lastActivity?.[ACTIVITY_LIMIT - 1]?.at).toBe(6);
	});

	it("shows the stored events at once after a restart and adds to them", () => {
		const first = loggedUi();
		first.ui.showStatus({ state: "synced" });

		const second = loggedUi(first.store);
		expect(second.inner.lastActivity).toEqual([{ at: 0, kind: "status", status: { state: "synced" } }]);

		second.ui.showStatus({ state: "synced" });
		second.ui.showStatus({ state: "offline" });
		expect(second.inner.lastActivity?.map((event) => event.kind === "status" && event.status.state)).toEqual(["offline", "synced"]);
	});

	it("passes lists and prompts through to the UI unchanged", async () => {
		const { inner, ui } = loggedUi();
		inner.firstSyncAnswers.push({ differing: "keepRemote" });
		const conflicts = { conflicted: ["note.md"], copies: [], configuration: [] };

		ui.showSkipped([{ path: "big.pdf", reason: "tooLarge" }]);
		ui.showConflicts(conflicts);
		const answer = await ui.askFirstSync({ toDownload: [], toUpload: [], identical: [], differing: [] });

		expect(inner.lastSkipped).toEqual([{ path: "big.pdf", reason: "tooLarge" }]);
		expect(inner.lastConflicts).toEqual(conflicts);
		expect(answer).toEqual({ differing: "keepRemote" });
	});
});
