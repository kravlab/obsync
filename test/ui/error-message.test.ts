import { describe, expect, it } from "vitest";
import { ProviderError } from "../../src/engine/provider";
import { providerErrorDetailLine } from "../../src/ui/error-message";
import { selectStrings } from "../../src/ui/i18n/strings";

describe("providerErrorDetailLine", () => {
	it("tells what the provider answered, in English and Russian", () => {
		const error = new ProviderError({ category: "permanent" }, "HTTP 400: bad client_id");

		expect(providerErrorDetailLine(error, selectStrings("en"))).toBe("Details: HTTP 400: bad client_id");
		expect(providerErrorDetailLine(error, selectStrings("ru"))).toBe("Подробности: HTTP 400: bad client_id");
	});

	it("is absent for a failure with nothing to tell", () => {
		expect(providerErrorDetailLine(new ProviderError({ category: "permanent" }, ""), selectStrings("en"))).toBeUndefined();
	});
});
