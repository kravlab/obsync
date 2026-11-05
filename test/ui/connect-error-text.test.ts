import { describe, expect, it } from "vitest";
import { copiedError, withConnectErrorLog } from "../../src/ui/connect-error-text";
import { ManualClock } from "../fakes/manual-clock";
import { RecordingUi } from "../fakes/test-device";

/** 2026-10-21 16:37 on the test machine's own clock. */
const AFTERNOON = new Date(2026, 9, 21, 16, 37).getTime();

/** A log file that keeps the lines appended to it. */
class RecordingLog {
	readonly lines: string[] = [];

	append(line: string): Promise<void> {
		this.lines.push(line);
		return Promise.resolve();
	}
}

describe("withConnectErrorLog", () => {
	it("writes a failure while connecting to the file, worded in English as in a bug report, and passes it on", () => {
		const inner = new RecordingUi();
		const log = new RecordingLog();
		const clock = new ManualClock();
		clock.advance(AFTERNOON);
		const failure = { cause: "permanent", detail: 'HTTP 400: Bad HTTP "Content-Type" header' } as const;

		withConnectErrorLog(inner, log, clock).reportConnectFailure(failure);

		expect(log.lines).toEqual([
			'2026-10-21 16:37 Connecting failed. Dropbox refused a request. (HTTP 400: Bad HTTP "Content-Type" header)',
		]);
		expect(inner.connectFailures).toEqual([failure]);
	});

	it("writes a failure without a detail without parentheses", () => {
		const log = new RecordingLog();
		const clock = new ManualClock();
		clock.advance(AFTERNOON);

		withConnectErrorLog(new RecordingUi(), log, clock).reportConnectFailure({ cause: "transient" });

		expect(log.lines).toEqual(["2026-10-21 16:37 Connecting failed. Dropbox could not be reached."]);
	});

	it("writes a refused code with the service's answer, in English", () => {
		const log = new RecordingLog();
		const clock = new ManualClock();
		clock.advance(AFTERNOON);

		withConnectErrorLog(new RecordingUi(), log, clock).reportConnectFailure({ cause: "codeRejected", detail: "invalid_grant" });

		expect(log.lines).toEqual(["2026-10-21 16:37 Connecting failed. Dropbox did not accept the code. (invalid_grant)"]);
	});

	it("writes a revoke that failed on disconnect, in English, and passes it on", () => {
		const inner = new RecordingUi();
		const log = new RecordingLog();
		const clock = new ManualClock();
		clock.advance(AFTERNOON);
		const failure = { cause: "transient", detail: "no response" } as const;

		withConnectErrorLog(inner, log, clock).reportRevokeFailure(failure);

		expect(log.lines).toEqual([
			"2026-10-21 16:37 Disconnecting: the login could not be revoked. Dropbox could not be reached. (no response)",
		]);
		expect(inner.revokeFailures).toEqual([failure]);
	});

	it("passes statuses and lists on unchanged, writing nothing", () => {
		const inner = new RecordingUi();
		const log = new RecordingLog();
		const ui = withConnectErrorLog(inner, log, new ManualClock());

		ui.showStatus({ state: "connected" });
		ui.showSkipped([]);

		expect(inner.statuses).toEqual([{ state: "connected" }]);
		expect(inner.skippedLists).toEqual([[]]);
		expect(log.lines).toEqual([]);
	});
});

describe("copiedError", () => {
	it("is the message and its details line, one per line", () => {
		expect(copiedError({ text: "Dropbox refused the request. Try again later.", detailLine: "Details: HTTP 400: x" })).toBe(
			"Dropbox refused the request. Try again later.\nDetails: HTTP 400: x",
		);
	});

	it("is the message alone without a details line", () => {
		expect(copiedError({ text: "Dropbox cannot be reached. Check the connection and try again." })).toBe(
			"Dropbox cannot be reached. Check the connection and try again.",
		);
	});
});
