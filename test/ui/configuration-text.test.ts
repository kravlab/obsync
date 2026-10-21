import { describe, expect, it } from "vitest";
import { selectStrings } from "../../src/ui/i18n/strings";
import { keptConfigurationItem, keptConfigurationLine } from "../../src/ui/configuration-text";

const kept = [
	{ id: "2", path: ".obsidian-mobile/app.json", keptAt: 2_000 },
	{ id: "1", path: ".obsidian-mobile/hotkeys.json", keptAt: 1_000 },
];

describe("keptConfigurationLine", () => {
	it("tells how many configuration versions are kept and the command that restores them, in English and Russian", () => {
		expect(keptConfigurationLine(kept, selectStrings("en"))).toBe(
			"2 local configuration versions kept; restore them with “Restore local configuration”",
		);
		expect(keptConfigurationLine(kept, selectStrings("ru"))).toBe(
			"Сохранено локальных версий конфигурации: 2; восстановить их можно командой «Восстановить локальную конфигурацию»",
		);
	});

	it("tells nothing when no version is kept", () => {
		expect(keptConfigurationLine([], selectStrings("en"))).toBeNull();
	});
});

describe("keptConfigurationItem", () => {
	it("names a kept version by its file and when it was kept, in local time, in English and Russian", () => {
		const version = { id: "1", path: ".obsidian-mobile/app.json", keptAt: new Date(2026, 9, 20, 14, 5).getTime() };
		expect(keptConfigurationItem(version, selectStrings("en"))).toBe(".obsidian-mobile/app.json, kept 2026-10-20 14:05");
		expect(keptConfigurationItem(version, selectStrings("ru"))).toBe(".obsidian-mobile/app.json, сохранено 2026-10-20 14:05");
	});
});
