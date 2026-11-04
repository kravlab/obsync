import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIGURATION_CATEGORIES } from "../../src/engine/configuration";
import type { TestDevice } from "../fakes/test-device";
import { ALL_CATEGORIES as ALL, laptopAndPhone, localConfig, remoteConfig, writeConfig } from "../support/configuration";
import { putRemoteFile, remoteText, syncNow, vaultText } from "../support/sync";

/** Whether `device`'s Sync snapshot records anything in its configuration folder. */
function snapshotHasConfiguration(device: TestDevice): boolean {
	const { configDir } = device.vault;
	return [...device.deviceStore.snapshot.keys()].some((path) => path === configDir || path.startsWith(`${configDir}/`));
}

describe("configuration categories", () => {
	it("syncs nothing of the configuration folder while every category is off, the default", async () => {
		const { remote, laptop, phone } = await laptopAndPhone();
		expect(laptop.configurationCategories).toEqual(DEFAULT_CONFIGURATION_CATEGORIES);
		await writeConfig(laptop, "app.json", "{}");
		putRemoteFile(remote, remoteConfig("hotkeys.json"), "{}");
		await syncNow(laptop);
		await syncNow(phone);
		expect(remote.get(remoteConfig("app.json"))).toBeUndefined();
		expect(await laptop.vault.stat(localConfig(laptop, "hotkeys.json"))).toBeNull();
		expect(await phone.vault.stat(localConfig(phone, "hotkeys.json"))).toBeNull();
		expect(snapshotHasConfiguration(laptop)).toBe(false);
		expect(laptop.ui.lastSkipped).toEqual([]);
	});

	it("shares a category between devices whose configuration folders have different names", async () => {
		const { remote, laptop, phone } = await laptopAndPhone();
		laptop.configurationCategories = ALL;
		phone.configurationCategories = ALL;
		await writeConfig(laptop, "app.json", '{"spellcheck":true}');
		await syncNow(laptop);
		expect(remoteText(remote, remoteConfig("app.json"))).toBe('{"spellcheck":true}');
		expect(remote.get(`${laptop.vault.configDir}/app.json`)).toBeUndefined();
		await syncNow(phone);
		expect(await vaultText(phone, ".phone-config/app.json")).toBe('{"spellcheck":true}');
		await writeConfig(phone, "app.json", '{"spellcheck":false}');
		await syncNow(phone);
		await syncNow(laptop);
		expect(await vaultText(laptop, localConfig(laptop, "app.json"))).toBe('{"spellcheck":false}');
	});

	it("syncs each device's own choice of categories", async () => {
		const { remote, laptop, phone } = await laptopAndPhone();
		laptop.configurationCategories = ALL;
		phone.configurationCategories = { ...DEFAULT_CONFIGURATION_CATEGORIES, themesAndSnippets: true };
		await writeConfig(laptop, "app.json", "{}");
		await writeConfig(laptop, "plugins/calendar/main.js", "code");
		await writeConfig(laptop, "snippets/wide.css", "body {}");
		await syncNow(laptop);
		await writeConfig(phone, "hotkeys.json", '{"phone":1}');
		await writeConfig(phone, "appearance.json", '{"theme":"dark"}');
		await syncNow(phone);
		await syncNow(laptop);
		expect(await vaultText(phone, ".phone-config/snippets/wide.css")).toBe("body {}");
		expect(await phone.vault.stat(".phone-config/app.json")).toBeNull();
		expect(await phone.vault.stat(".phone-config/plugins/calendar/main.js")).toBeNull();
		expect(remote.get(remoteConfig("hotkeys.json"))).toBeUndefined();
		expect(await vaultText(laptop, localConfig(laptop, "appearance.json"))).toBe('{"theme":"dark"}');
	});

	it("never syncs the workspace layout files or this plugin's own folder", async () => {
		const { remote, laptop, phone } = await laptopAndPhone();
		laptop.configurationCategories = ALL;
		phone.configurationCategories = ALL;
		await writeConfig(laptop, "workspace.json", "{}");
		await writeConfig(laptop, "workspace-mobile.json", "{}");
		await writeConfig(laptop, "workspaces.json", "{}");
		await writeConfig(laptop, "plugins/seamsync/data.json", "{}");
		await writeConfig(laptop, "plugins/calendar/data.json", "{}");
		await syncNow(laptop);
		expect(laptop.pluginDir).toBe(localConfig(laptop, "plugins/seamsync"));
		expect(remote.get(remoteConfig("plugins/calendar/data.json"))?.kind).toBe("file");
		for (const path of ["workspace.json", "workspace-mobile.json", "workspaces.json", "plugins/seamsync"]) {
			expect(remote.get(remoteConfig(path))).toBeUndefined();
		}
		putRemoteFile(remote, remoteConfig("workspace.json"), '{"other":1}');
		await syncNow(phone);
		expect(await phone.vault.stat(".phone-config/workspace.json")).toBeNull();
	});

	it("leaves out a Remote folder under this device's own configuration folder name", async () => {
		const { remote, phone } = await laptopAndPhone();
		phone.configurationCategories = ALL;
		putRemoteFile(remote, ".phone-config/app.json", '{"stray":1}');
		putRemoteFile(remote, remoteConfig("app.json"), '{"shared":1}');
		await syncNow(phone);
		expect(await vaultText(phone, ".phone-config/app.json")).toBe('{"shared":1}');
		expect(remoteText(remote, ".phone-config/app.json")).toBe('{"stray":1}');
	});

	it("unions both sides when a category is turned on, deleting nothing", async () => {
		const { remote, laptop, phone } = await laptopAndPhone();
		phone.configurationCategories = ALL;
		await writeConfig(phone, "hotkeys.json", "{}");
		await writeConfig(phone, "app.json", '{"same":1}');
		await syncNow(phone);
		await writeConfig(laptop, "graph.json", '{"laptop":1}');
		await writeConfig(laptop, "app.json", '{"same":1}');
		laptop.configurationCategories = ALL;
		await syncNow(laptop);
		expect(laptop.ui.prompts).toEqual([]);
		expect(await vaultText(laptop, localConfig(laptop, "hotkeys.json"))).toBe("{}");
		expect(remoteText(remote, remoteConfig("graph.json"))).toBe('{"laptop":1}');
		expect(remoteText(remote, remoteConfig("app.json"))).toBe('{"same":1}');
		expect(laptop.deviceStore.snapshot.has(localConfig(laptop, "app.json"))).toBe(true);
	});

	it("forgets a category turned off, so a delete on either side is not carried while it is off", async () => {
		const { remote, laptop, phone } = await laptopAndPhone();
		laptop.configurationCategories = ALL;
		phone.configurationCategories = ALL;
		await writeConfig(laptop, "app.json", "{}");
		await syncNow(laptop);
		await syncNow(phone);
		laptop.configurationCategories = DEFAULT_CONFIGURATION_CATEGORIES;
		await syncNow(laptop);
		expect(snapshotHasConfiguration(laptop)).toBe(false);
		await laptop.vault.trash(localConfig(laptop, "app.json"));
		await syncNow(laptop);
		expect(remoteText(remote, remoteConfig("app.json"))).toBe("{}");
		await phone.vault.trash(".phone-config/app.json");
		// One synced file of one is over the Deletion guard's share.
		phone.ui.answers.push("apply");
		await syncNow(phone);
		expect(remote.get(remoteConfig("app.json"))).toBeUndefined();
		await writeConfig(laptop, "app.json", '{"kept":1}');
		await syncNow(laptop);
		expect(await vaultText(laptop, localConfig(laptop, "app.json"))).toBe('{"kept":1}');
		expect(remote.get(remoteConfig("app.json"))).toBeUndefined();
	});

	it("brings back on turning a category on again what the Remote still has, as a union", async () => {
		const { remote, laptop, phone } = await laptopAndPhone();
		laptop.configurationCategories = ALL;
		phone.configurationCategories = ALL;
		await writeConfig(laptop, "app.json", "{}");
		await syncNow(laptop);
		laptop.configurationCategories = DEFAULT_CONFIGURATION_CATEGORIES;
		await syncNow(laptop);
		await laptop.vault.trash(localConfig(laptop, "app.json"));
		laptop.configurationCategories = ALL;
		await syncNow(laptop);
		expect(await vaultText(laptop, localConfig(laptop, "app.json"))).toBe("{}");
		expect(remoteText(remote, remoteConfig("app.json"))).toBe("{}");
		await syncNow(phone);
		expect(await vaultText(phone, ".phone-config/app.json")).toBe("{}");
	});
});
