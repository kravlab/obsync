import { en, type Strings } from "./en";
import { ru } from "./ru";

export type { Strings };

/**
 * String tables by Obsidian language code (as returned by `getLanguage()`).
 * A Map, so a code that names an Object.prototype member finds nothing.
 */
const tables: ReadonlyMap<string, Strings> = new Map([
	["en", en],
	["ru", ru],
]);

/**
 * Returns the UI strings for an Obsidian language code. A language without
 * a translation gets English, Obsidian's own default.
 */
export function selectStrings(language: string): Strings {
	return tables.get(language) ?? en;
}
