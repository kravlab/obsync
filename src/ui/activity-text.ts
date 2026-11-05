import type { ActivityEvent } from "../engine/activity-log";
import type { ConnectFailureCause } from "../engine/connection";
import type { SyncFailureCause } from "../engine/status";
import { fill } from "./i18n/fill";
import type { Strings } from "./i18n/strings";
import { noticeText } from "./notice-text";
import { statusLabel } from "./status-label";
import { timeText } from "./time-text";

/**
 * One event of the activity log in plain words, after its local date and
 * time, in the user's language: a notice as it was told, a status by its
 * label, and a failed sync or connect with why it failed and, in
 * parentheses, its detail if it has one.
 */
export function activityLine(event: ActivityEvent, strings: Strings): string {
	return fill(strings.activityLine, { time: timeText(event.at), text: eventText(event, strings) });
}

/** What `event` tells, without its time. */
function eventText(event: ActivityEvent, strings: Strings): string {
	switch (event.kind) {
		case "notice":
			return noticeText(event.notice, strings);
		case "connectFailed":
			return failureLine(strings.activityConnectFailed, connectFailureText(event.cause, strings), event.detail, strings);
		case "revokeFailed":
			return failureLine(strings.activityRevokeFailed, failureText(event.cause, strings), event.detail, strings);
		case "status":
			if (event.status.state !== "syncFailed") return statusLabel(event.status, strings);
			return failureLine(strings.activitySyncFailed, failureText(event.status.cause, strings), event.status.detail, strings);
	}
}

/**
 * A failure told by `template` with `cause`, why it failed, followed by
 * `detail` in parentheses; without them when there is no detail, as in
 * events stored before failures kept one, or one stored empty.
 */
function failureLine(template: string, cause: string, detail: string | undefined, strings: Strings): string {
	const text = fill(template, { cause });
	return detail === undefined || detail === "" ? text : fill(strings.activityDetail, { text, detail });
}

/** Why connecting failed, in the user's language: a refusal of its own, or a cause a sync can fail for too. */
function connectFailureText(cause: ConnectFailureCause, strings: Strings): string {
	switch (cause) {
		case "codeRejected":
			return strings.connectFailureCodeRejected;
		case "otherAccount":
			return strings.connectFailureOtherAccount;
		case "nameTaken":
			return strings.connectFailureNameTaken;
		case "invalidName":
			return strings.connectFailureInvalidName;
		case "firstSyncInProgress":
			return strings.connectFailureFirstSyncInProgress;
		default:
			return failureText(cause, strings);
	}
}

/** Why a provider call or a sync failed, in the user's language. */
function failureText(cause: SyncFailureCause, strings: Strings): string {
	switch (cause) {
		case "auth":
			return strings.failureAuth;
		case "throttled":
			return strings.failureThrottled;
		case "transient":
			return strings.failureTransient;
		case "notFound":
			return strings.failureNotFound;
		case "preconditionFailed":
			return strings.failurePreconditionFailed;
		case "cursorLost":
			return strings.failureCursorLost;
		case "quotaExceeded":
			return strings.failureQuotaExceeded;
		case "tooLarge":
			return strings.failureTooLarge;
		case "nameNotRepresentable":
			return strings.failureNameNotRepresentable;
		case "permanent":
			return strings.failurePermanent;
		case "unsupportedProvider":
			return strings.failureUnsupportedProvider;
		case "unreadableSettings":
			return strings.failureUnreadableSettings;
		case "bug":
			return strings.failureBug;
	}
}
