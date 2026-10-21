/**
 * The configuration folder's part in sync (spec, "Synced file scope",
 * configuration folder): which of its paths belong to which category a
 * device switches on or off, which never sync, and the one name the
 * folder has on the Remote.
 *
 * Categories, by path relative to the folder:
 * - `settingsAndHotkeys`: every file directly in it not named below, such
 *   as `app.json`, `hotkeys.json`, `core-plugins.json` and the core
 *   plugins' settings;
 * - `themesAndSnippets`: `themes/`, `snippets/` and `appearance.json`,
 *   which names the chosen theme and the enabled snippets;
 * - `plugins`: `plugins/`, other plugins' code and settings, and
 *   `community-plugins.json`, the list of enabled ones.
 *
 * Never synced: the workspace layout files (`workspace.json`,
 * `workspace-mobile.json`, `workspaces.json`), this plugin's own folder
 * and `plugins/<its id>`, any other subfolder (its content is unknown), and any path with a
 * segment inside the folder that starts with a dot.
 */
import type { VaultEntry, VaultPath } from "./local-vault";
import { isWithin, pathKey } from "./paths";
import type { PathCodec } from "./name-policy";
import type { RemotePath } from "./provider";

/**
 * The name the configuration folder has on the Remote, whatever each
 * device calls it. It is not Obsidian's default name: the community
 * ruleset (`obsidianmd/hardcoded-config-path`) allows that name nowhere in
 * plugin code, since a vault's folder must come from `vault.configDir`.
 */
export const REMOTE_CONFIGURATION_FOLDER: RemotePath = ".obsidian-config";

/** One part of the configuration folder a device syncs or not. */
export type ConfigurationCategory = "settingsAndHotkeys" | "themesAndSnippets" | "plugins";

/** Every category, in the order the settings show them. */
export const CONFIGURATION_CATEGORIES: readonly ConfigurationCategory[] = ["settingsAndHotkeys", "themesAndSnippets", "plugins"];

/** Which categories this device syncs. */
export type ConfigurationCategories = Readonly<Record<ConfigurationCategory, boolean>>;

/** What a device starts with: no category synced. */
export const DEFAULT_CONFIGURATION_CATEGORIES: ConfigurationCategories = {
	settingsAndHotkeys: false,
	themesAndSnippets: false,
	plugins: false,
};

/** Where the configuration folder and this plugin's own folder are in this device's vault. */
export interface ConfigurationLayout {
	/** The vault's configuration folder (`vault.configDir`). */
	readonly configDir: VaultPath;
	/** This plugin's own folder inside it (`manifest.dir`), which never syncs. */
	readonly pluginDir: VaultPath;
	/**
	 * This plugin's id (`manifest.id`): `plugins/<id>` never syncs either,
	 * so another device's copy, installed under its id while this device's
	 * folder has another name, is not taken for an ordinary plugin.
	 */
	readonly pluginId: string;
}

/** The workspace layout files, which never sync: each device keeps its own panes. */
const WORKSPACE_FILES: ReadonlySet<string> = new Set(["workspace.json", "workspace-mobile.json", "workspaces.json"]);

/** The subfolders a category holds, with that category. */
const CATEGORY_FOLDERS: ReadonlyMap<string, ConfigurationCategory> = new Map([
	["plugins", "plugins"],
	["themes", "themesAndSnippets"],
	["snippets", "themesAndSnippets"],
]);

/** The files directly in the folder that belong to a category other than settings and hotkeys. */
const CATEGORY_FILES: ReadonlyMap<string, ConfigurationCategory> = new Map([
	["appearance.json", "themesAndSnippets"],
	["community-plugins.json", "plugins"],
]);

/**
 * The categories the vault entry of `kind` at `path` belongs to; it syncs
 * while any of them is on. Empty for an entry in the configuration folder
 * that never syncs, null for one outside it. The folder itself belongs to
 * every category. Names are compared as they are: Obsidian writes them so.
 */
export function configurationCategoriesOf(
	path: VaultPath,
	kind: VaultEntry["kind"],
	layout: ConfigurationLayout,
): readonly ConfigurationCategory[] | null {
	const { configDir, pluginDir, pluginId } = layout;
	if (!isWithin(path, configDir)) return null;
	if (path === configDir) return kind === "folder" ? CONFIGURATION_CATEGORIES : [];
	const segments = path.slice(configDir.length + 1).split("/");
	if (segments.some((segment) => segment.startsWith(".")) || isWithin(path, pluginDir)) return [];
	const [top = "", ...inside] = segments;
	if (top === "plugins" && inside[0] === pluginId) return [];
	const folderCategory = CATEGORY_FOLDERS.get(top);
	if (inside.length > 0 || kind === "folder") return folderCategory === undefined ? [] : [folderCategory];
	if (WORKSPACE_FILES.has(top)) return [];
	return [CATEGORY_FILES.get(top) ?? "settingsAndHotkeys"];
}

/**
 * `codec` with the configuration folder `configDir` stored under
 * `REMOTE_CONFIGURATION_FOLDER`, so devices whose folders have different
 * names share one configuration. The two names are swapped both ways, so
 * the mapping stays reversible: a Remote folder under this device's own
 * name reads as the shared name, a hidden path this device never lists.
 * Names are matched without case on a case-insensitive provider. The swap
 * happens on vault names, before `codec` encodes them.
 */
export function withConfigurationFolder(codec: PathCodec, configDir: VaultPath, caseInsensitive: boolean): PathCodec {
	/** `path` with `from` at its start, or within it, put as `to`; null when it is not there. */
	const moved = (path: string, from: string, to: string): string | null =>
		isWithin(pathKey(path, caseInsensitive), pathKey(from, caseInsensitive)) ? to + path.slice(from.length) : null;
	/** `path` with the two names swapped. */
	const swap = (path: string): string =>
		moved(path, configDir, REMOTE_CONFIGURATION_FOLDER) ?? moved(path, REMOTE_CONFIGURATION_FOLDER, configDir) ?? path;
	return {
		toRemote: (path) => codec.toRemote(swap(path)),
		toVault: (path) => swap(codec.toVault(path)),
	};
}
