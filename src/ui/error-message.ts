import { detailField } from "../engine/failure-detail";
import { ProviderError } from "../engine/provider";
import { fill } from "./i18n/fill";
import type { Strings } from "./i18n/strings";

/**
 * The message telling the user a provider failure: "cannot be reached" for
 * failures that pass with time or connectivity, "refused" for the rest.
 */
export function providerErrorMessage(error: ProviderError, strings: Strings): string {
	switch (error.failure.category) {
		case "transient":
		case "throttled":
			return strings.errorUnreachable;
		default:
			return strings.errorFailed;
	}
}

/**
 * The line telling what went wrong on a failure, `error`'s detail as
 * `failureDetail` gives it, shown under its message so it can be read off
 * the screen; undefined when the failure has nothing to tell.
 */
export function errorDetailLine(error: unknown, strings: Strings): string | undefined {
	return detailLine(detailField(error).detail, strings);
}

/** The line showing `detail` under a failure's message; undefined without one. */
export function detailLine(detail: string | undefined, strings: Strings): string | undefined {
	return detail === undefined ? undefined : fill(strings.errorDetails, { detail });
}

