/**
 * The text of a failure while connecting or revoking on disconnect outside
 * the activity log (spec of copying a connect error): the line the log
 * file keeps, and what the connect window's "Copy error" button copies.
 */
import type { ActivityEvent } from "../engine/activity-log";
import type { ConnectFailure, ConnectionUi, RevokeFailure } from "../engine/connection";
import type { Clock } from "../engine/ports";
import { activityLine } from "./activity-text";
import { selectStrings } from "./i18n/strings";

/**
 * A failure shown at the top of a connect window screen, offered to copy:
 * its text, and the line telling what went wrong when there is something
 * to tell, such as the service's answer or an error's name and message.
 */
export interface ScreenMessage {
	readonly text: string;
	readonly detailLine?: string | undefined;
}

/** Where failures while connecting or revoking on disconnect are written down, one line each. */
export interface ConnectionErrorLog {
	/** Adds `line`; never rejects. */
	append(line: string): Promise<void>;
}

/**
 * `ui` that also writes each failure while connecting, and each revoke on
 * disconnect that failed, to `log`, at `clock`'s time, as the English line
 * "Copy for a bug report" gives it, so the file reads the same whatever
 * the user's language. Everything else passes through unchanged.
 */
export function withConnectErrorLog(ui: ConnectionUi, log: ConnectionErrorLog, clock: Clock): ConnectionUi {
	const english = selectStrings("en");
	/** Appends `event`'s English line. */
	const write = (event: ActivityEvent): void => void log.append(activityLine(event, english));
	return {
		showStatus: (status) => ui.showStatus(status),
		showSkipped: (files) => ui.showSkipped(files),
		showConflicts: (conflicts) => ui.showConflicts(conflicts),
		reportConnectFailure(failure: ConnectFailure) {
			ui.reportConnectFailure(failure);
			write({ at: clock.now(), kind: "connectFailed", ...failure });
		},
		reportRevokeFailure(failure: RevokeFailure) {
			ui.reportRevokeFailure(failure);
			write({ at: clock.now(), kind: "revokeFailed", ...failure });
		},
	};
}

/** What "Copy error" copies: `message` as shown, its details line on the next line if it has one. */
export function copiedError(message: ScreenMessage): string {
	return message.detailLine === undefined ? message.text : `${message.text}\n${message.detailLine}`;
}
