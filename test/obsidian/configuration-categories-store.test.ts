import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIGURATION_CATEGORIES } from "../../src/engine/configuration";
import {
	storableConfigurationCategories,
	storedConfigurationCategories,
} from "../../src/obsidian/configuration-categories-store";

describe("stored configuration categories", () => {
	it("reads a missing record as every category off", () => {
		expect(storedConfigurationCategories(null)).toEqual(DEFAULT_CONFIGURATION_CATEGORIES);
	});

	it("reads back the categories it stored", () => {
		const categories = { settingsAndHotkeys: true, themesAndSnippets: false, plugins: true };
		expect(storedConfigurationCategories(storableConfigurationCategories(categories))).toEqual(categories);
	});

	it("reads a record of another format version or a malformed one as every category off", () => {
		const stored = [
			{ formatVersion: 2, settingsAndHotkeys: true, themesAndSnippets: true, plugins: true },
			{ formatVersion: 1, settingsAndHotkeys: "yes", themesAndSnippets: true, plugins: true },
			{ formatVersion: 1, settingsAndHotkeys: true },
			"on",
		];
		for (const value of stored) {
			expect(storedConfigurationCategories(value), JSON.stringify(value)).toEqual(DEFAULT_CONFIGURATION_CATEGORIES);
		}
	});
});
