import { describe, expect, it } from "vitest";
import { createSyncEngine } from "../../src/engine/engine";
import { DEFAULT_REMOTE_SETTINGS, METADATA_FOLDER, SETTINGS_PATH, encodeSettings } from "../../src/engine/remote-metadata";
import { FakeRemote } from "../fakes/fake-remote";
import { connectTestDevice, type TestDevice } from "../fakes/test-device";
import { bytes, text } from "../support/bytes";
import { ALL_CATEGORIES, laptopAndPhone, localConfig, remoteConfig, writeConfig } from "../support/configuration";
import { forgetNotices, mirror, remoteText, syncNow, vaultText } from "../support/sync";

/**
 * `app.json` as Obsidian writes it, one setting per line, with `a` and `b`
 * set; a setting between them keeps their lines apart, so edits to the two
 * do not touch and merge.
 */
function appJson(a: number, b: number): string {
	return `{\n\t"a": ${a},\n\t"between": 0,\n\t"b": ${b}\n}\n`;
}

/** The kept local versions on `device`, as path and text, oldest first. */
async function keptTexts(device: TestDevice): Promise<{ path: string; text: string }[]> {
	const kept = [...(await device.configurationConflicts.list())].reverse();
	return Promise.all(
		kept.map(async ({ id, path }) => {
			const data = await device.configurationConflicts.read(id);
			if (data === null) throw new Error(`kept version ${id} has no data`);
			return { path, text: text(data) };
		}),
	);
}

/** The Remote's file paths inside the configuration folder, sorted. */
function remoteConfigFiles(remote: FakeRemote): string[] {
	return mirror(remote)
		.filter((entry) => entry.kind === "file" && entry.path.startsWith(remoteConfig("")))
		.map((entry) => entry.path)
		.sort();
}

/** A laptop and a phone with every category on, both holding `app.json` as `appJson(1, 1)`, synced. */
async function sharedAppJson(): Promise<{ remote: FakeRemote; laptop: TestDevice; phone: TestDevice }> {
	const devices = await laptopAndPhone();
	const { laptop, phone } = devices;
	laptop.configurationCategories = ALL_CATEGORIES;
	phone.configurationCategories = ALL_CATEGORIES;
	await writeConfig(laptop, "app.json", appJson(1, 1));
	await syncNow(laptop);
	await syncNow(phone);
	forgetNotices(laptop, phone);
	return devices;
}

describe("a configuration file changed on both devices", () => {
	it("is merged when the merge is clean and still parses as JSON", async () => {
		const { remote, laptop, phone } = await sharedAppJson();
		await writeConfig(laptop, "app.json", appJson(2, 1));
		await writeConfig(phone, "app.json", appJson(1, 2));
		await syncNow(laptop);
		await syncNow(phone);
		expect(await vaultText(phone, ".phone-config/app.json")).toBe(appJson(2, 2));
		expect(remoteText(remote, remoteConfig("app.json"))).toBe(appJson(2, 2));
		expect(await phone.configurationConflicts.list()).toEqual([]);
	});

	it("keeps the Remote version and this device's restorable when the JSON does not merge", async () => {
		const { remote, laptop, phone } = await sharedAppJson();
		await writeConfig(laptop, "app.json", appJson(2, 1));
		await writeConfig(phone, "app.json", appJson(3, 1));
		await syncNow(laptop);
		await syncNow(phone);
		expect(await vaultText(phone, ".phone-config/app.json")).toBe(appJson(2, 1));
		expect(remoteText(remote, remoteConfig("app.json"))).toBe(appJson(2, 1));
		expect(await keptTexts(phone)).toEqual([{ path: ".phone-config/app.json", text: appJson(3, 1) }]);
		expect(phone.ui.lastConfigurationConflicts).toEqual(await phone.configurationConflicts.list());
		expect(remoteConfigFiles(remote)).toEqual([remoteConfig("app.json")]);
		expect(phone.ui.notices.filter((notice) => notice.kind === "conflictCopyCreated")).toEqual([]);
	});

	it("never gets Conflict blocks, even as a text extension: the Remote version of a snippet wins", async () => {
		const remote = new FakeRemote();
		remote.put(METADATA_FOLDER, { kind: "folder" });
		remote.put(SETTINGS_PATH, {
			kind: "file",
			data: encodeSettings({ ...DEFAULT_REMOTE_SETTINGS, textExtensions: ["md", "txt", "css"] }),
			revision: remote.nextRevision(),
		});
		const laptop = connectTestDevice(remote, "Laptop");
		const phone = connectTestDevice(remote, "Phone", { configDir: ".phone-config" });
		laptop.configurationCategories = ALL_CATEGORIES;
		phone.configurationCategories = ALL_CATEGORIES;
		await writeConfig(laptop, "snippets/wide.css", "body {\n}\n");
		await syncNow(laptop);
		await syncNow(phone);
		await writeConfig(laptop, "snippets/wide.css", "body { width: 90%; }\n");
		await writeConfig(phone, "snippets/wide.css", "body { width: 80%; }\n");
		await syncNow(laptop);
		await syncNow(phone);
		expect(await vaultText(phone, ".phone-config/snippets/wide.css")).toBe("body { width: 90%; }\n");
		expect(await keptTexts(phone)).toEqual([{ path: ".phone-config/snippets/wide.css", text: "body { width: 80%; }\n" }]);
	});

	it("keeps nothing while the file is typed into, and keeps it once after the post-edit pause", async () => {
		const { laptop, phone } = await sharedAppJson();
		await writeConfig(laptop, "app.json", appJson(2, 1));
		await syncNow(laptop);
		await phone.vault.typeInto(".phone-config/app.json", bytes(appJson(3, 1)));

		await syncNow(phone);

		expect(await vaultText(phone, ".phone-config/app.json")).toBe(appJson(3, 1));
		expect(await phone.configurationConflicts.list()).toEqual([]);
		phone.clock.advance(phone.schedule.editPause.ms);
		await syncNow(phone);
		expect(await vaultText(phone, ".phone-config/app.json")).toBe(appJson(2, 1));
		expect(await keptTexts(phone)).toEqual([{ path: ".phone-config/app.json", text: appJson(3, 1) }]);
	});

	it("keeps every conflict's local version, a second one on the same file too", async () => {
		const { laptop, phone } = await sharedAppJson();
		await writeConfig(laptop, "app.json", appJson(2, 1));
		await writeConfig(phone, "app.json", appJson(3, 1));
		await syncNow(laptop);
		await syncNow(phone);
		phone.clock.advance(60_000);
		await writeConfig(laptop, "app.json", appJson(4, 1));
		await writeConfig(phone, "app.json", appJson(5, 1));
		await syncNow(laptop);
		await syncNow(phone);
		expect(await keptTexts(phone)).toEqual([
			{ path: ".phone-config/app.json", text: appJson(3, 1) },
			{ path: ".phone-config/app.json", text: appJson(5, 1) },
		]);
		const [newest, oldest] = await phone.configurationConflicts.list();
		expect(newest?.keptAt).toBeGreaterThan(oldest?.keptAt ?? Infinity);
	});
});

describe("Restore local", () => {
	it("puts the kept version back, takes it off the list, and the sync uploads it", async () => {
		const { remote, laptop, phone } = await sharedAppJson();
		await writeConfig(laptop, "app.json", appJson(2, 1));
		await writeConfig(phone, "app.json", appJson(3, 1));
		await syncNow(laptop);
		await syncNow(phone);
		const [kept] = await phone.configurationConflicts.list();
		if (kept === undefined) throw new Error("no kept version");

		await createSyncEngine(phone.ports).restoreConfiguration(kept.id);

		expect(await vaultText(phone, ".phone-config/app.json")).toBe(appJson(3, 1));
		expect(await phone.configurationConflicts.list()).toEqual([]);
		expect(phone.ui.lastConfigurationConflicts).toEqual([]);
		expect(remoteText(remote, remoteConfig("app.json"))).toBe(appJson(3, 1));
		await syncNow(laptop);
		expect(await vaultText(laptop, localConfig(laptop, "app.json"))).toBe(appJson(3, 1));
	});

	it("brings back a kept version whose file is gone, folders included", async () => {
		const { laptop, phone } = await sharedAppJson();
		await writeConfig(laptop, "snippets/wide.css", "a");
		await syncNow(laptop);
		await syncNow(phone);
		await writeConfig(laptop, "snippets/wide.css", "laptop");
		await writeConfig(phone, "snippets/wide.css", "phone");
		await syncNow(laptop);
		await syncNow(phone);
		await phone.vault.trash(".phone-config/snippets/wide.css");
		await phone.vault.trash(".phone-config/snippets");
		const [kept] = await phone.configurationConflicts.list();
		if (kept === undefined) throw new Error("no kept version");

		await createSyncEngine(phone.ports).restoreConfiguration(kept.id);

		expect(await vaultText(phone, ".phone-config/snippets/wide.css")).toBe("phone");
	});

	it("waits for a sync under way, then wins over what that sync downloaded", async () => {
		const { remote, laptop, phone } = await sharedAppJson();
		await writeConfig(laptop, "app.json", appJson(2, 1));
		await writeConfig(phone, "app.json", appJson(3, 1));
		await syncNow(laptop);
		await syncNow(phone);
		const [kept] = await phone.configurationConflicts.list();
		if (kept === undefined) throw new Error("no kept version");
		await writeConfig(laptop, "app.json", appJson(4, 1));
		await syncNow(laptop);
		const engine = createSyncEngine(phone.ports);
		let restoring!: Promise<void>;
		phone.provider.beforeNextRead(remoteConfig("app.json"), () => {
			restoring = engine.restoreConfiguration(kept.id);
			return Promise.resolve();
		});

		await engine.sync();
		await restoring;

		expect(await vaultText(phone, ".phone-config/app.json")).toBe(appJson(3, 1));
		expect(remoteText(remote, remoteConfig("app.json"))).toBe(appJson(3, 1));
		expect(await phone.configurationConflicts.list()).toEqual([]);
	});

	it("does nothing for a version no longer kept", async () => {
		const { phone } = await sharedAppJson();
		await createSyncEngine(phone.ports).restoreConfiguration("gone");
		expect(await vaultText(phone, ".phone-config/app.json")).toBe(appJson(1, 1));
	});
});

describe("a rename onto a configuration path that is taken", () => {
	it("keeps this device's new file restorable when the Remote renamed a file onto its path", async () => {
		const { laptop, phone } = await laptopAndPhone({ stableIds: true });
		laptop.configurationCategories = ALL_CATEGORIES;
		phone.configurationCategories = ALL_CATEGORIES;
		await writeConfig(laptop, "snippets/a.css", "renamed there");
		await syncNow(laptop);
		await syncNow(phone);
		await laptop.vault.rename(localConfig(laptop, "snippets/a.css"), localConfig(laptop, "snippets/b.css"));
		await syncNow(laptop);
		await writeConfig(phone, "snippets/b.css", "new here");

		await syncNow(phone);

		expect(await vaultText(phone, ".phone-config/snippets/b.css")).toBe("renamed there");
		expect(await phone.vault.stat(".phone-config/snippets/a.css")).toBeNull();
		expect(await keptTexts(phone)).toEqual([{ path: ".phone-config/snippets/b.css", text: "new here" }]);
		expect((await phone.vault.list()).map((entry) => entry.path).filter((path) => path.includes("conflict"))).toEqual([]);
		expect(phone.ui.notices.filter((notice) => notice.kind === "conflictCopyCreated")).toEqual([]);
	});

	it("keeps this device's renamed file restorable when the Remote has another file at its new path", async () => {
		const { remote, laptop, phone } = await laptopAndPhone();
		laptop.configurationCategories = ALL_CATEGORIES;
		phone.configurationCategories = ALL_CATEGORIES;
		await writeConfig(laptop, "snippets/a.css", "mine");
		await syncNow(laptop);
		await syncNow(phone);
		await writeConfig(phone, "snippets/taken.css", "theirs");
		await syncNow(phone);
		await laptop.vault.rename(localConfig(laptop, "snippets/a.css"), localConfig(laptop, "snippets/taken.css"));

		await syncNow(laptop);

		expect(await vaultText(laptop, localConfig(laptop, "snippets/taken.css"))).toBe("theirs");
		expect(await keptTexts(laptop)).toEqual([{ path: localConfig(laptop, "snippets/taken.css"), text: "mine" }]);
		expect(remoteConfigFiles(remote)).toEqual([remoteConfig("snippets/taken.css")]);
		expect(remoteText(remote, remoteConfig("snippets/taken.css"))).toBe("theirs");
		expect(laptop.ui.notices.filter((notice) => notice.kind === "conflictCopyCreated")).toEqual([]);
	});

	it("leaves the old Remote file when another device edited it, so the edit downloads back", async () => {
		const { remote, laptop, phone } = await laptopAndPhone();
		laptop.configurationCategories = ALL_CATEGORIES;
		phone.configurationCategories = ALL_CATEGORIES;
		await writeConfig(laptop, "snippets/a.css", "mine");
		await syncNow(laptop);
		await syncNow(phone);
		await writeConfig(phone, "snippets/taken.css", "theirs");
		await writeConfig(phone, "snippets/a.css", "edited there");
		await syncNow(phone);
		await laptop.vault.rename(localConfig(laptop, "snippets/a.css"), localConfig(laptop, "snippets/taken.css"));

		await syncNow(laptop);

		expect(remoteText(remote, remoteConfig("snippets/a.css"))).toBe("edited there");
		expect(await vaultText(laptop, localConfig(laptop, "snippets/a.css"))).toBe("edited there");
		expect(await vaultText(laptop, localConfig(laptop, "snippets/taken.css"))).toBe("theirs");
		expect(await keptTexts(laptop)).toEqual([{ path: localConfig(laptop, "snippets/taken.css"), text: "mine" }]);
	});
});

describe("a First sync with configuration categories on", () => {
	it("previews a differing configuration file as Remote kept, then keeps this device's version restorable", async () => {
		const { remote, laptop } = await sharedAppJson();
		const tablet = connectTestDevice(remote, "Tablet", { configDir: ".tablet-config" });
		tablet.configurationCategories = ALL_CATEGORIES;
		await writeConfig(tablet, "app.json", appJson(9, 9));

		await syncNow(tablet);

		expect(tablet.ui.previews[0]?.differing).toEqual([{ path: ".tablet-config/app.json", outcome: "remoteKept" }]);
		expect(await vaultText(tablet, ".tablet-config/app.json")).toBe(appJson(1, 1));
		expect(await keptTexts(tablet)).toEqual([{ path: ".tablet-config/app.json", text: appJson(9, 9) }]);
		expect(remoteText(remote, remoteConfig("app.json"))).toBe(appJson(1, 1));
		expect(laptop.ui.notices).toEqual([]);
	});
});
