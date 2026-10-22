/**
 * The text of a failure while connecting outside the activity log (spec
 * of copying a connect error): the line the log file keeps, and what the
 * connect window's "Copy error" button copies.
 */
import type { ConnectFailure, ConnectionUi } from "../engine/connection";
import type { Clock } from "../engine/ports";
import { activityLine } from "./activity-text";
import { selectStrings } from "./i18n/strings";

/**
 * A message at the top of a connect window screen: its text, and for a
 * provider failure the line telling what the provider answered and
 * `copyable`, which offers it to copy.
 */
export interface ScreenMessage {
	readonly text: string;
	readonly detailLine?: string;
	readonly copyable?: boolean;
}

/** Where failures while connecting are written down, one line each. */
export interface ConnectErrorLog {
	/** Adds `line`; never rejects. */
	append(line: string): Promise<void>;
}

/**
 * `ui` that also writes each failure while connecting to `log`, at
 * `clock`'s time, as the English line "Copy for a bug report" gives it, so
 * the file reads the same whatever the user's language. Everything else
 * passes through unchanged.
 */
export function withConnectErrorLog(ui: ConnectionUi, log: ConnectErrorLog, clock: Clock): ConnectionUi {
	const english = selectStrings("en");
	return {
		showStatus: (status) => ui.showStatus(status),
		showSkipped: (files) => ui.showSkipped(files),
		showConflicts: (conflicts) => ui.showConflicts(conflicts),
		reportConnectFailure(failure: ConnectFailure) {
			ui.reportConnectFailure(failure);
			void log.append(activityLine({ at: clock.now(), kind: "connectFailed", ...failure }, english));
		},
	};
}

/** What "Copy error" copies: `message` as shown, its details line on the next line if it has one. */
export function copiedError(message: ScreenMessage): string {
	return message.detailLine === undefined ? message.text : `${message.text}\n${message.detailLine}`;
}
