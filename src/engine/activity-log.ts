/**
 * The activity log (spec, "Status, notices, guidance"): what happened on
 * this device, in facts the shell words for the Sync window's Activity tab
 * and for "Copy for a bug report". It keeps every notice and every change
 * of the sync status, so nothing the user was told is lost once a notice
 * fades. It is kept on this device across restarts, behind its own store.
 *
 * It is recorded by `withActivityLog`, a UI port in front of the shell's:
 * the engine and the connection service both report through it, so no
 * notice or status can bypass the log.
 */
import type { SyncNotice } from "./notices";
import type { ConnectFailure, ConnectionUi, RevokeFailure } from "./connection";
import type { Clock, UiPort } from "./ports";
import type { SyncStatus } from "./status";

/** How many events the log keeps; older ones are dropped. */
export const ACTIVITY_LIMIT = 100;

/**
 * One thing that happened, at `at` (ms since the epoch by the engine's
 * Clock): a notice told to the user, the sync status changing to
 * `status`, connecting this device failing as a `ConnectFailure` tells,
 * or the revoke on disconnect failing as a `RevokeFailure` tells.
 */
export type ActivityEvent =
	| { readonly at: number; readonly kind: "notice"; readonly notice: SyncNotice }
	| { readonly at: number; readonly kind: "status"; readonly status: SyncStatus }
	| ({ readonly at: number; readonly kind: "connectFailed" } & ConnectFailure)
	| ({ readonly at: number; readonly kind: "revokeFailed" } & RevokeFailure);

/** Where this device keeps its activity log; never synced. */
export interface ActivityStore {
	/** The events kept, newest first; none when nothing is kept or it is unreadable. */
	load(): readonly ActivityEvent[];
	/** Keeps `events`, newest first, replacing what was kept. */
	save(events: readonly ActivityEvent[]): void;
}

/** A UI port that also shows the activity log. */
export interface ActivityUi extends UiPort {
	/** Shows the activity log, newest first; it replaces the log shown before. */
	showActivity(events: readonly ActivityEvent[]): void;
}

/**
 * `ui` with an activity log kept in `store`: every notice, every failure
 * while connecting or revoking on disconnect, and every status that
 * differs from the last status logged (a failure differs by its cause or
 * its detail), is recorded at `clock`'s time before `ui` shows it, and the
 * whole log is shown again. Syncing… is never logged, so each poll's
 * Syncing… and Synced do not flood it. The stored log is shown at once. A
 * failure while connecting or revoking is only logged: the connect window
 * and the disconnect notice tell it. Everything else passes through
 * unchanged. It serves both the engine and the connection service.
 */
export function withActivityLog(ui: ActivityUi, store: ActivityStore, clock: Clock): UiPort & ConnectionUi {
	let events = store.load();
	ui.showActivity(events);

	/** Adds `event` at the top, drops what is beyond the limit, keeps and shows the log. */
	function record(event: ActivityEvent): void {
		events = [event, ...events].slice(0, ACTIVITY_LIMIT);
		store.save(events);
		ui.showActivity(events);
	}

	/** The status logged last, if any. */
	function lastStatus(): SyncStatus | undefined {
		for (const event of events) if (event.kind === "status") return event.status;
		return undefined;
	}

	return {
		showStatus(status) {
			if (status.state !== "syncing" && !sameStatus(status, lastStatus())) {
				record({ at: clock.now(), kind: "status", status });
			}
			ui.showStatus(status);
		},
		showNotice(notice) {
			record({ at: clock.now(), kind: "notice", notice });
			ui.showNotice(notice);
		},
		showSkipped: (files) => ui.showSkipped(files),
		showConflicts: (conflicts) => ui.showConflicts(conflicts),
		askDeletions: (prompt) => ui.askDeletions(prompt),
		askFirstSync: (preview) => ui.askFirstSync(preview),
		reportConnectFailure: (failure) => record({ at: clock.now(), kind: "connectFailed", ...failure }),
		reportRevokeFailure: (failure) => record({ at: clock.now(), kind: "revokeFailed", ...failure }),
	};
}

/** Whether `a` and `b` are the same status, a failure with the same cause and detail. */
function sameStatus(a: SyncStatus, b: SyncStatus | undefined): boolean {
	if (b === undefined || a.state !== b.state) return false;
	return a.state !== "syncFailed" || (b.state === "syncFailed" && a.cause === b.cause && a.detail === b.detail);
}
