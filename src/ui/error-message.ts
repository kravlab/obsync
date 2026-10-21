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
 * The line telling what the provider answered on a failure, shown under its
 * message so it can be read off the screen; undefined when the failure has
 * nothing to tell.
 */
export function providerErrorDetailLine(error: ProviderError, strings: Strings): string | undefined {
	const { detail } = detailField(error);
	return detail === undefined ? undefined : fill(strings.errorDetails, { detail });
}

