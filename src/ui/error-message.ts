import { ProviderError } from "../engine/provider";
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

