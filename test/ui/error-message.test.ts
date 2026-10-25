import { describe, expect, it } from "vitest";
import { ProviderError } from "../../src/engine/provider";
import { detailLine, errorDetailLine } from "../../src/ui/error-message";
import { selectStrings } from "../../src/ui/i18n/strings";

describe("errorDetailLine", () => {
	it("tells what the provider answered, in English and Russian", () => {
		const error = new ProviderError({ category: "permanent" }, "HTTP 400: bad client_id");

		expect(errorDetailLine(error, selectStrings("en"))).toBe("Details: HTTP 400: bad client_id");
		expect(errorDetailLine(error, selectStrings("ru"))).toBe("Подробности: HTTP 400: bad client_id");
	});

	it("tells an unexpected error by its name and message", () => {
		expect(errorDetailLine(new TypeError("boom"), selectStrings("en"))).toBe("Details: TypeError: boom");
	});

	it("is absent for a failure with nothing to tell", () => {
		expect(errorDetailLine(new ProviderError({ category: "permanent" }, ""), selectStrings("en"))).toBeUndefined();
	});
});

describe("detailLine", () => {
	it("shows a detail given as text", () => {
		expect(detailLine("invalid_grant", selectStrings("en"))).toBe("Details: invalid_grant");
	});

	it("is absent without a detail", () => {
		expect(detailLine(undefined, selectStrings("en"))).toBeUndefined();
	});
});
