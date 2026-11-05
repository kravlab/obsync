import { describe, expect, it } from "vitest";
import {
	REMOTE_CONFIGURATION_FOLDER,
	configurationCategoriesOf,
	withConfigurationFolder,
	type ConfigurationLayout,
} from "../../src/engine/configuration";
import type { PathCodec } from "../../src/engine/name-policy";

/** A device whose configuration folder is not Obsidian's usual name, with this plugin installed in it. */
const layout: ConfigurationLayout = { configDir: ".vault-config", pluginDir: ".vault-config/plugins/seamsync", pluginId: "seamsync" };

/** The categories of the file at `path`, relative to the configuration folder. */
function fileCategories(path: string): readonly string[] | null {
	return configurationCategoriesOf(`${layout.configDir}/${path}`, "file", layout);
}

/** The categories of the folder at `path`, relative to the configuration folder. */
function folderCategories(path: string): readonly string[] | null {
	return configurationCategoriesOf(`${layout.configDir}/${path}`, "folder", layout);
}

/** A codec that stores every path as it is. */
const asIs: PathCodec = { toRemote: (path) => path, toVault: (path) => path };

describe("configurationCategoriesOf", () => {
	it("gives null for a path outside the configuration folder, even one sharing its name's start", () => {
		expect(configurationCategoriesOf("notes/app.json", "file", layout)).toBeNull();
		expect(configurationCategoriesOf(".vault-config-old/app.json", "file", layout)).toBeNull();
	});

	it("puts every file directly in the folder under settings and hotkeys", () => {
		for (const name of ["app.json", "hotkeys.json", "core-plugins.json", "daily-notes.json", "types.json", "notes.txt"]) {
			expect(fileCategories(name)).toEqual(["settingsAndHotkeys"]);
		}
	});

	it("puts themes, snippets and the appearance settings under themes and snippets", () => {
		expect(fileCategories("appearance.json")).toEqual(["themesAndSnippets"]);
		expect(fileCategories("themes/Minimal/theme.css")).toEqual(["themesAndSnippets"]);
		expect(fileCategories("snippets/wide.css")).toEqual(["themesAndSnippets"]);
		expect(folderCategories("themes")).toEqual(["themesAndSnippets"]);
		expect(folderCategories("themes/Minimal")).toEqual(["themesAndSnippets"]);
		expect(folderCategories("snippets")).toEqual(["themesAndSnippets"]);
	});

	it("puts other plugins, with their settings, and the enabled list under plugins", () => {
		expect(fileCategories("community-plugins.json")).toEqual(["plugins"]);
		expect(fileCategories("plugins/calendar/main.js")).toEqual(["plugins"]);
		expect(fileCategories("plugins/calendar/data.json")).toEqual(["plugins"]);
		expect(folderCategories("plugins")).toEqual(["plugins"]);
		expect(folderCategories("plugins/calendar")).toEqual(["plugins"]);
	});

	it("gives the folder itself every category, so it syncs while any one is on", () => {
		expect(configurationCategoriesOf(layout.configDir, "folder", layout)).toEqual([
			"settingsAndHotkeys",
			"themesAndSnippets",
			"plugins",
		]);
	});

	it("never syncs the workspace layout files", () => {
		expect(fileCategories("workspace.json")).toEqual([]);
		expect(fileCategories("workspace-mobile.json")).toEqual([]);
		expect(fileCategories("workspaces.json")).toEqual([]);
	});

	it("never syncs this plugin's own folder or anything in it", () => {
		expect(folderCategories("plugins/seamsync")).toEqual([]);
		expect(fileCategories("plugins/seamsync/data.json")).toEqual([]);
		expect(fileCategories("plugins/seamsync/configuration-conflicts/1/app.json")).toEqual([]);
		expect(fileCategories("plugins/seamsync-extra/main.js")).toEqual(["plugins"]);
	});

	it("never syncs this plugin under its id either, when this device installed it in a folder of another name", () => {
		const renamed: ConfigurationLayout = { ...layout, pluginDir: ".vault-config/plugins/seamsync-dev" };
		for (const path of [
			"plugins/seamsync-dev/data.json",
			"plugins/seamsync/data.json",
			"plugins/seamsync/configuration-conflicts/a",
		]) {
			expect(configurationCategoriesOf(`${layout.configDir}/${path}`, "file", renamed), path).toEqual([]);
		}
		expect(configurationCategoriesOf(`${layout.configDir}/plugins/seamsync`, "folder", renamed)).toEqual([]);
		expect(configurationCategoriesOf(`${layout.configDir}/plugins/calendar/data.json`, "file", renamed)).toEqual(["plugins"]);
	});

	it("never syncs other subfolders, or files deeper in them, whose content is unknown", () => {
		expect(folderCategories("icons")).toEqual([]);
		expect(fileCategories("icons/star.svg")).toEqual([]);
	});

	it("never syncs a path with a hidden segment inside the folder", () => {
		expect(fileCategories(".hotreload")).toEqual([]);
		expect(fileCategories("plugins/calendar/.hotreload")).toEqual([]);
		expect(folderCategories("plugins/calendar/.git")).toEqual([]);
		expect(fileCategories("snippets/.DS_Store")).toEqual([]);
	});

	it("never syncs a file where the folder itself is", () => {
		expect(configurationCategoriesOf(layout.configDir, "file", layout)).toEqual([]);
	});
});

describe("withConfigurationFolder", () => {
	it("stores the configuration folder under the one Remote name and reads it back under this device's", () => {
		const codec = withConfigurationFolder(asIs, layout.configDir, false);
		expect(codec.toRemote(".vault-config/app.json")).toBe(`${REMOTE_CONFIGURATION_FOLDER}/app.json`);
		expect(codec.toRemote(".vault-config")).toBe(REMOTE_CONFIGURATION_FOLDER);
		expect(codec.toVault(`${REMOTE_CONFIGURATION_FOLDER}/plugins/calendar/main.js`)).toBe(".vault-config/plugins/calendar/main.js");
		expect(codec.toVault(REMOTE_CONFIGURATION_FOLDER)).toBe(".vault-config");
	});

	it("leaves every other path as the inner codec has it", () => {
		const codec = withConfigurationFolder(asIs, layout.configDir, false);
		expect(codec.toRemote("notes/app.json")).toBe("notes/app.json");
		expect(codec.toVault(".seamsync/settings.json")).toBe(".seamsync/settings.json");
		expect(codec.toVault(".vault-config-old/app.json")).toBe(".vault-config-old/app.json");
	});

	it("swaps the two names, so a Remote folder under this device's own name maps to the hidden shared name and back", () => {
		const codec = withConfigurationFolder(asIs, layout.configDir, false);
		expect(codec.toVault(".vault-config/app.json")).toBe(`${REMOTE_CONFIGURATION_FOLDER}/app.json`);
		expect(codec.toRemote(`${REMOTE_CONFIGURATION_FOLDER}/app.json`)).toBe(".vault-config/app.json");
	});

	it("changes nothing for a device using the shared name itself", () => {
		const codec = withConfigurationFolder(asIs, REMOTE_CONFIGURATION_FOLDER, false);
		expect(codec.toRemote(`${REMOTE_CONFIGURATION_FOLDER}/app.json`)).toBe(`${REMOTE_CONFIGURATION_FOLDER}/app.json`);
		expect(codec.toVault(`${REMOTE_CONFIGURATION_FOLDER}/app.json`)).toBe(`${REMOTE_CONFIGURATION_FOLDER}/app.json`);
	});

	it("matches the Remote name without case on a case-insensitive provider only", () => {
		const insensitive = withConfigurationFolder(asIs, layout.configDir, true);
		const shouted = `${REMOTE_CONFIGURATION_FOLDER.toUpperCase()}/app.json`;
		expect(insensitive.toVault(shouted)).toBe(".vault-config/app.json");
		const sensitive = withConfigurationFolder(asIs, layout.configDir, false);
		expect(sensitive.toVault(shouted)).toBe(shouted);
	});

	it("keeps the inner codec's refusals and encoding", () => {
		const inner: PathCodec = {
			toRemote: (path) => (path.includes(":") ? null : path.replace("?", "？")),
			toVault: (path) => path.replace("？", "?"),
		};
		const codec = withConfigurationFolder(inner, layout.configDir, false);
		expect(codec.toRemote(".vault-config/a:b.json")).toBeNull();
		expect(codec.toRemote(".vault-config/why?.json")).toBe(`${REMOTE_CONFIGURATION_FOLDER}/why？.json`);
		expect(codec.toVault(`${REMOTE_CONFIGURATION_FOLDER}/why？.json`)).toBe(".vault-config/why?.json");
	});
});
