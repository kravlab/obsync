import { describe, expect, it } from "vitest";
import { ALL_CATEGORIES, laptopAndPhone, localConfig, writeConfig } from "../support/configuration";
import { forgetNotices, syncNow, writeVaultFile } from "../support/sync";

/** A laptop and a phone with every category on, both holding `app.json` and `hotkeys.json`, synced, notices forgotten. */
async function sharedSettings(): ReturnType<typeof laptopAndPhone> {
	const devices = await laptopAndPhone();
	const { laptop, phone } = devices;
	laptop.configurationCategories = ALL_CATEGORIES;
	phone.configurationCategories = ALL_CATEGORIES;
	await writeConfig(laptop, "app.json", "{}");
	await writeConfig(laptop, "hotkeys.json", "{}");
	await syncNow(laptop);
	await syncNow(phone);
	forgetNotices(laptop, phone);
	return devices;
}

describe("the restart notice", () => {
	it("tells once per sync that settings arrived, however many configuration files it wrote", async () => {
		const { laptop, phone } = await sharedSettings();
		await writeConfig(laptop, "app.json", '{"a":1}');
		await writeConfig(laptop, "hotkeys.json", '{"a":1}');
		await writeConfig(laptop, "snippets/wide.css", "body {}");
		await syncNow(laptop);
		await syncNow(phone);
		expect(phone.ui.notices).toEqual([{ kind: "configurationChanged" }]);
	});

	it("is not shown by the sync that uploads this device's own configuration changes", async () => {
		const { laptop } = await sharedSettings();
		await writeConfig(laptop, "app.json", '{"a":1}');
		await syncNow(laptop);
		expect(laptop.ui.notices).toEqual([]);
	});

	it("is not shown when only notes arrive", async () => {
		const { laptop, phone } = await sharedSettings();
		await writeVaultFile(laptop, "notes/day.md", "day");
		await syncNow(laptop);
		await syncNow(phone);
		expect(phone.ui.notices).toEqual([]);
	});

	it("is shown when a configuration file deleted on another device goes to the trash here", async () => {
		const { laptop, phone } = await sharedSettings();
		await laptop.vault.trash(localConfig(laptop, "hotkeys.json"));
		await syncNow(laptop);
		await syncNow(phone);
		expect(phone.vault.trashed).toEqual([".phone-config/hotkeys.json"]);
		expect(phone.ui.notices).toEqual([{ kind: "configurationChanged" }]);
	});

	it("is shown when a configuration conflict puts the Remote version in place", async () => {
		const { laptop, phone } = await sharedSettings();
		await writeConfig(laptop, "app.json", '{"laptop":1}');
		await writeConfig(phone, "app.json", '{"phone":1}');
		await syncNow(laptop);
		await syncNow(phone);
		expect(phone.ui.notices).toEqual([{ kind: "configurationChanged" }]);
	});
});
