/**
 * The Per-request limit (spec, "Provider contract", data transfer): no
 * single HTTP request or response body a Provider sends or receives is
 * larger than it. It is a per-device user setting in whole MiB, under
 * 20 MB, since Android crashed on larger bodies; a user whose device fails
 * even below that lowers it.
 */
import { isWholeNumberIn, parseWholeNumber } from "./whole-number";

/** One MiB, the setting's unit, as the size ceiling also counts. */
const MEBIBYTE = 1024 * 1024;

/** The limit a device starts with, in MiB. */
const DEFAULT_MEBIBYTES = 16;

/** The smallest limit the setting takes, in MiB. */
const MIN_MEBIBYTES = 1;

/** The largest limit the setting takes, in MiB: 19 MiB is 19,922,944 bytes, under 20 MB. */
const MAX_MEBIBYTES = 19;

/** A Per-request limit, in the setting's unit and in bytes. */
export interface RequestLimit {
	/** The limit as the user sets it: a whole number of MiB from 1 to 19. */
	readonly mebibytes: number;
	/** The same limit in bytes: the largest body a request or response may have. */
	readonly bytes: number;
}

/** The limit a device has until its user sets one. */
export const DEFAULT_REQUEST_LIMIT: RequestLimit = limitOf(DEFAULT_MEBIBYTES);

/** The limit of `mebibytes` MiB, or null when the setting does not take it. */
export function requestLimitOf(mebibytes: number): RequestLimit | null {
	return isWholeNumberIn(mebibytes, MIN_MEBIBYTES, MAX_MEBIBYTES) ? limitOf(mebibytes) : null;
}

/** The limit the user typed, or null when it is not one. */
export function parseRequestLimit(typed: string): RequestLimit | null {
	const mebibytes = parseWholeNumber(typed, MIN_MEBIBYTES, MAX_MEBIBYTES);
	return mebibytes === null ? null : limitOf(mebibytes);
}

/** The limit of `mebibytes` MiB, unchecked. */
function limitOf(mebibytes: number): RequestLimit {
	return { mebibytes, bytes: mebibytes * MEBIBYTE };
}
