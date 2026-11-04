import type { App } from "obsidian";
import { DEFAULT_REQUEST_LIMIT, requestLimitOf, type RequestLimit } from "../engine/request-limit";

/** The localStorage key of this vault's Per-request limit. */
const REQUEST_LIMIT_KEY = "seamsync-request-limit";

/** The format version of the stored limit. */
const REQUEST_LIMIT_FORMAT_VERSION = 1;

/** The limit as a device stores it. */
interface StoredRequestLimit {
	/** The record's format; another version reads as no limit stored. */
	readonly formatVersion: typeof REQUEST_LIMIT_FORMAT_VERSION;
	/** The limit in MiB. */
	readonly mebibytes: number;
}

/**
 * This device's Per-request limit, in Obsidian's per-vault localStorage:
 * never in `data.json` or the vault, and apart from the Connection, so a
 * disconnect keeps it.
 */
export class ObsidianRequestLimitStore {
	/** @param app the Obsidian app whose localStorage holds the limit */
	constructor(private readonly app: App) {}

	/** The stored limit, or the default when none is stored or it is unreadable. */
	load(): RequestLimit {
		return storedRequestLimit(this.app.loadLocalStorage(REQUEST_LIMIT_KEY));
	}

	/** Stores `limit`; a Provider opened from now on keeps to it. */
	save(limit: RequestLimit): void {
		this.app.saveLocalStorage(REQUEST_LIMIT_KEY, storableRequestLimit(limit));
	}
}

/**
 * The limit in a stored record, as `App.loadLocalStorage` returns it; the
 * default when the record is missing, of another format version, or holds
 * a limit the setting does not take.
 */
export function storedRequestLimit(stored: unknown): RequestLimit {
	const record = stored as Partial<StoredRequestLimit> | null;
	const limit =
		typeof record === "object" &&
		record?.formatVersion === REQUEST_LIMIT_FORMAT_VERSION &&
		typeof record.mebibytes === "number"
			? requestLimitOf(record.mebibytes)
			: null;
	return limit ?? DEFAULT_REQUEST_LIMIT;
}

/** The record `App.saveLocalStorage` keeps for `limit`. */
export function storableRequestLimit(limit: RequestLimit): StoredRequestLimit {
	return { formatVersion: REQUEST_LIMIT_FORMAT_VERSION, mebibytes: limit.mebibytes };
}
