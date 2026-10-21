import type { ActivityEvent } from "../engine/activity-log";
import type { SyncFailureCause } from "../engine/status";
import { fill } from "./i18n/fill";
import type { Strings } from "./i18n/strings";
import { noticeText } from "./notice-text";
import { statusLabel } from "./status-label";
import { timeText } from "./time-text";

/**
 * One event of the activity log in plain words, after its local date and
 * time, in the user's language: a notice as it was told, a status by its
 * label, and a failed sync with why it failed.
 */
export function activityLine(event: ActivityEvent, strings: Strings): string {
	const text =
		event.kind === "notice"
			? noticeText(event.notice, strings)
			: event.status.state === "syncFailed"
				? fill(strings.activitySyncFailed, { cause: failureText(event.status.cause, strings) })
				: statusLabel(event.status, strings);
	return fill(strings.activityLine, { time: timeText(event.at), text });
}

/** Why a sync failed, in the user's language. */
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
