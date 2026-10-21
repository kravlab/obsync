import { describe, expect, it } from "vitest";
import { selectStrings } from "../../src/ui/i18n/strings";
import { keptConfigurationItem } from "../../src/ui/configuration-text";

describe("keptConfigurationItem", () => {
	it("names a kept version by its file and when it was kept, in local time, in English and Russian", () => {
		const version = { id: "1", path: ".obsidian-mobile/app.json", keptAt: new Date(2026, 9, 20, 14, 5).getTime() };
		expect(keptConfigurationItem(version, selectStrings("en"))).toBe(".obsidian-mobile/app.json, kept 2026-10-20 14:05");
		expect(keptConfigurationItem(version, selectStrings("ru"))).toBe(".obsidian-mobile/app.json, сохранено 2026-10-20 14:05");
	});
});
