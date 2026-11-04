import type { App } from "obsidian";
import type { ActivityEvent, ActivityStore } from "../engine/activity-log";
import type { ConnectFailureCause, RevokeFailure } from "../engine/connection";
import type { SyncNotice } from "../engine/notices";
import type { ProviderErrorCategory } from "../engine/provider";
import type { SyncFailureCause, SyncStatus } from "../engine/status";
import { isRecord } from "./is-record";

/** The localStorage key of this vault's activity log. */
const ACTIVITY_KEY = "seamsync-activity";

/** The format version of the stored activity log. */
const ACTIVITY_FORMAT_VERSION = 1;

/** The activity log as a device stores it. */
interface StoredActivity {
	/** The record's format; another version reads as no events. */
	readonly formatVersion: typeof ACTIVITY_FORMAT_VERSION;
	/** The events, newest first. */
	readonly events: readonly ActivityEvent[];
}

/**
 * This device's activity log, in Obsidian's per-vault localStorage: never
 * in `data.json` or the vault, and apart from the Connection, so a
 * disconnect keeps it for a bug report.
 */
export class ObsidianActivityStore implements ActivityStore {
	/** @param app the Obsidian app whose localStorage holds the log */
	constructor(private readonly app: App) {}

	load(): readonly ActivityEvent[] {
		return storedActivity(this.app.loadLocalStorage(ACTIVITY_KEY));
	}

	save(events: readonly ActivityEvent[]): void {
		this.app.saveLocalStorage(ACTIVITY_KEY, storableActivity(events));
	}
}

/**
 * The events in a stored record, as `App.loadLocalStorage` returns it, in
 * their stored order; none when the record is missing, of another format
 * version, or not a list. A malformed event is left out, the others kept,
 * since the log is a record for the user, not state sync depends on.
 */
export function storedActivity(stored: unknown): ActivityEvent[] {
	const record = stored as Partial<StoredActivity> | null;
	if (typeof record !== "object" || record?.formatVersion !== ACTIVITY_FORMAT_VERSION) return [];
	if (!Array.isArray(record.events)) return [];
	return (record.events as unknown[]).filter(isActivityEvent);
}

/** The record `App.saveLocalStorage` keeps for `events`. */
export function storableActivity(events: readonly ActivityEvent[]): StoredActivity {
	return { formatVersion: ACTIVITY_FORMAT_VERSION, events };
}

/** A check of the fields a stored status or notice must carry besides its state or kind. */
type FieldsCheck = (fields: Record<string, unknown>) => boolean;

/** For a status or notice without fields of its own. */
const noFields: FieldsCheck = () => true;

/** Every provider failure category, the causes of a failure while connecting; a record, so a category added to the type must be added here. */
const PROVIDER_CAUSES: Record<ProviderErrorCategory, true> = {
	auth: true,
	throttled: true,
	transient: true,
	notFound: true,
	preconditionFailed: true,
	cursorLost: true,
	quotaExceeded: true,
	tooLarge: true,
	nameNotRepresentable: true,
	permanent: true,
};

/** Every failure cause of a sync; a record, so a cause added to the type must be added here. */
const FAILURE_CAUSES: Record<SyncFailureCause, true> = {
	...PROVIDER_CAUSES,
	unsupportedProvider: true,
	unreadableSettings: true,
	bug: true,
};

/** The causes connecting fails for besides a provider failure; a record, so a cause added to the type must be added here. */
const CONNECT_REFUSALS: Record<Exclude<ConnectFailureCause, ProviderErrorCategory>, true> = {
	codeRejected: true,
	otherAccount: true,
	nameTaken: true,
	invalidName: true,
	unsupportedProvider: true,
	firstSyncInProgress: true,
	bug: true,
};

/** Every cause connecting fails for. */
const CONNECT_CAUSES: Record<ConnectFailureCause, true> = { ...PROVIDER_CAUSES, ...CONNECT_REFUSALS };

/** Every cause a revoke on disconnect fails for. */
const REVOKE_CAUSES: Record<RevokeFailure["cause"], true> = { ...PROVIDER_CAUSES, bug: true };

/** The sides a delete can be told on. */
const DELETED_ON: Record<"thisDevice" | "otherDevice", true> = { thisDevice: true, otherDevice: true };

/** The fields of each status state; a record, so a state added to the type must be added here. */
const STATUS_FIELDS: Record<SyncStatus["state"], FieldsCheck> = {
	notConnected: noFields,
	connected: noFields,
	syncing: noFields,
	synced: noFields,
	offline: noFields,
	syncFailed: (status) => isOneOf(status.cause, FAILURE_CAUSES) && isOptionalText(status.detail),
	reconnectNeeded: noFields,
	deletionsOnHold: noFields,
	firstSyncWaiting: noFields,
	settingsCollision: noFields,
};

/** The fields of each notice kind; a record, so a kind added to the type must be added here. */
const NOTICE_FIELDS: Record<SyncNotice["kind"], FieldsCheck> = {
	conflictCopyCreated: (notice) => typeof notice.path === "string" && typeof notice.copyPath === "string",
	restoredAfterDelete: (notice) => typeof notice.path === "string" && isOneOf(notice.deletedOn, DELETED_ON),
	renamedOnBoth: (notice) => typeof notice.path === "string" && typeof notice.localPath === "string",
	renameBeatsDelete: (notice) => typeof notice.path === "string" && isOneOf(notice.deletedOn, DELETED_ON),
	firstSyncDone: (notice) =>
		[notice.downloaded, notice.uploaded, notice.conflicted, notice.conflictCopies].every((count) => typeof count === "number"),
	configurationChanged: noFields,
	reconnectNeeded: noFields,
	namePolicyRefused: (notice) => Array.isArray(notice.paths) && notice.paths.every((path) => typeof path === "string"),
};

/**
 * Whether `value` is an activity event the shell can word: a time, and a
 * status of a known state or a notice of a known kind, with the fields
 * that state or kind carries, a failure while connecting with a known
 * cause, or a failed revoke with a known cause. A detail is
 * optional, since events stored before
 * failures kept one have none.
 */
function isActivityEvent(value: unknown): value is ActivityEvent {
	if (!isRecord(value) || typeof value.at !== "number") return false;
	if (value.kind === "notice") return hasFields(value.notice, "kind", NOTICE_FIELDS);
	if (value.kind === "status") return hasFields(value.status, "state", STATUS_FIELDS);
	if (value.kind === "connectFailed") return isOneOf(value.cause, CONNECT_CAUSES) && isOptionalText(value.detail);
	if (value.kind === "revokeFailed") return isOneOf(value.cause, REVOKE_CAUSES) && isOptionalText(value.detail);
	return false;
}

/** Whether `value` is absent or text. */
function isOptionalText(value: unknown): boolean {
	return value === undefined || typeof value === "string";
}

/** Whether `value` is a record whose `tag` field names an entry of `checks`, and whose fields pass that entry's check. */
function hasFields(value: unknown, tag: string, checks: Record<string, FieldsCheck>): boolean {
	if (!isRecord(value)) return false;
	const name = value[tag];
	return isOneOf(name, checks) && checks[name](value);
}

/** Whether `value` is a string naming one of `known`'s own keys. */
function isOneOf(value: unknown, known: object): value is string {
	return typeof value === "string" && Object.prototype.hasOwnProperty.call(known, value);
}
