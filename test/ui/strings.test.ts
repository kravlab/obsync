import { describe, expect, it } from "vitest";
import { selectStrings } from "../../src/ui/i18n/strings";

describe("selectStrings", () => {
	it("returns Russian strings when Obsidian's language is Russian", () => {
		expect(selectStrings("ru").statusNotConnected).toBe("Не подключено");
	});

	it("returns English strings when Obsidian's language is English", () => {
		expect(selectStrings("en").statusNotConnected).toBe("Not connected");
	});

	it("falls back to English for a language without a translation", () => {
		expect(selectStrings("de").statusNotConnected).toBe("Not connected");
	});
});
