import type { App } from "obsidian";
import { DEFAULT_CONFIGURATION_CATEGORIES, type ConfigurationCategories } from "../engine/configuration";

/** The localStorage key of this vault's configuration categories. */
const CATEGORIES_KEY = "seamsync-configuration-categories";

/** The format version of the stored categories. */
const CATEGORIES_FORMAT_VERSION = 1;

/** The categories as a device stores them. */
interface StoredConfigurationCategories extends ConfigurationCategories {
	/** The record's format; another version reads as every category off. */
	readonly formatVersion: typeof CATEGORIES_FORMAT_VERSION;
}

/**
 * This device's configuration categories, in Obsidian's per-vault
 * localStorage: a device setting, never in `data.json` or the vault, and
 * apart from the Connection, so a disconnect keeps them.
 */
export class ObsidianConfigurationCategoriesStore {
	/** @param app the Obsidian app whose localStorage holds the categories */
	constructor(private readonly app: App) {}

	/** The stored categories, or every category off when none are stored or they are unreadable. */
	load(): ConfigurationCategories {
		return storedConfigurationCategories(this.app.loadLocalStorage(CATEGORIES_KEY));
	}

	/** Stores `categories`. */
	save(categories: ConfigurationCategories): void {
		this.app.saveLocalStorage(CATEGORIES_KEY, storableConfigurationCategories(categories));
	}
}

/**
 * The categories in a stored record, as `App.loadLocalStorage` returns it;
 * every category off when the record is missing, of another format
 * version, or lacks a category.
 */
export function storedConfigurationCategories(stored: unknown): ConfigurationCategories {
	const record = stored as Partial<StoredConfigurationCategories> | null;
	if (typeof record !== "object" || record?.formatVersion !== CATEGORIES_FORMAT_VERSION) return DEFAULT_CONFIGURATION_CATEGORIES;
	const { settingsAndHotkeys, themesAndSnippets, plugins } = record;
	if (typeof settingsAndHotkeys !== "boolean" || typeof themesAndSnippets !== "boolean" || typeof plugins !== "boolean") {
		return DEFAULT_CONFIGURATION_CATEGORIES;
	}
	return { settingsAndHotkeys, themesAndSnippets, plugins };
}

/** The record `App.saveLocalStorage` keeps for `categories`. */
export function storableConfigurationCategories(categories: ConfigurationCategories): StoredConfigurationCategories {
	return { formatVersion: CATEGORIES_FORMAT_VERSION, ...categories };
}
