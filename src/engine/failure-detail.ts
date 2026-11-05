/**
 * The detail of a failure, kept with it in the activity log and in bug
 * reports, so a failure on a device can be diagnosed from what the user
 * copies (spec of provider error details).
 */
import { ProviderError } from "./provider";

/** How long a detail may be, in characters (code points), ellipsis included. */
const FAILURE_DETAIL_LIMIT = 300;

/**
 * The detail of `error`, on one line and at most `FAILURE_DETAIL_LIMIT`
 * characters: a provider failure's message as the provider wrote it, which
 * holds only what the service answered; another error's name and message;
 * any other thrown value as text. Empty when there is nothing to tell.
 * It is cut by code points, so a character outside the BMP, such as an
 * emoji in a file name, is never split in half.
 */
export function failureDetail(error: unknown): string {
	const text =
		error instanceof ProviderError ? error.message : error instanceof Error ? `${error.name}: ${error.message}` : String(error);
	const characters = Array.from(text.replace(/\s+/g, " ").trim());
	return characters.length > FAILURE_DETAIL_LIMIT ? `${characters.slice(0, FAILURE_DETAIL_LIMIT - 1).join("")}…` : characters.join("");
}

/**
 * The `detail` field a failure on `error` carries: its `failureDetail`, or
 * no field at all when that is empty, so "no detail" has one form.
 */
export function detailField(error: unknown): { readonly detail?: string } {
	const detail = failureDetail(error);
	return detail === "" ? {} : { detail };
}
