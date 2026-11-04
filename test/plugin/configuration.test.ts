// @vitest-environment jsdom
// Manual check 13 through the whole plugin, with "Sync plugins" switched on
// in the settings: a plugin's `data.json` arriving, new or changed, and
// `community-plugins.json` arriving each tell to restart Obsidian; on a
// configuration conflict the local version is kept, and "Restore local" in
// the Sync window and the command "Restore local configuration" bring it
// back, without a restart notice.
import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import { selectStrings } from "../../src/ui/i18n/strings";
import type { RestoreConfigurationModal } from "../../src/ui/restore-configuration-modal";
import type { FakeDropboxAccount } from "../fakes/fake-dropbox";
import { lastSyncWindow, remoteText, textOn, useDevices, type PluginDevice, type PluginDevices } from "../support/plugin-devices";
import { PLUGIN_WAIT, buttonIn, fieldIn } from "../support/plugin-run";
import { DEVICE_TEST_TIMEOUT_MS } from "../support/timeouts";

const strings = selectStrings("en");

const newDevices = useDevices();

/** Another plugin's settings, by path in the configuration folder. */
const PLUGIN_DATA = "plugins/other-plugin/data.json";

/** The list of enabled community plugins, by path in the configuration folder. */
const COMMUNITY_PLUGINS = "community-plugins.json";

/** `PLUGIN_DATA` as the device that finds a conflict wrote it last: its local version, which is kept. */
const MINE = '{"from":"mine"}';

/** `PLUGIN_DATA` as the other device wrote it first: the version the conflict leaves in place. */
const THEIRS = '{"from":"theirs"}';

/** `path` in `device`'s configuration folder, as a vault path. */
function inConfig(device: PluginDevice, path: string): string {
	return `${device.app.vault.configDir}/${path}`;
}

/** The text the Remote holds for `path` of the configuration folder, which it keeps under its own name; null when none. */
function configOnRemote(account: FakeDropboxAccount, path: string): string | null {
	return remoteText(account, "Laptop vault", `.obsidian-config/${path}`);
}

/** Switches "Sync plugins" on in `device`'s settings tab, as the user does. */
function syncPluginsOn(device: PluginDevice): void {
	const toggle = fieldIn(device.root, strings.settingsCategoryPlugins);
	toggle.checked = true;
	toggle.dispatchEvent(new Event("change"));
}

/** How many restart notices `device` has shown. */
function restartNotices(device: PluginDevice): number {
	return device.notices().filter((message) => message === strings.noticeConfigurationChanged).length;
}

/** Resolves once `device` says it is synced. */
async function synced(device: PluginDevice): Promise<void> {
	await vi.waitFor(() => expect(device.status()).toContain(strings.statusSynced), PLUGIN_WAIT);
}

/**
 * A laptop and a phone through their First syncs, each then syncing
 * plugins, and the laptop's new `PLUGIN_DATA` carried to the phone: a new
 * file arriving there, so its first restart notice.
 */
async function bothSyncingPlugins() {
	const { dropbox, devices } = newDevices();
	const account = dropbox.addAccount("account-1");
	const laptop = await devices.start("Laptop vault", { files: { "note.md": "hello" } });
	const phone = await devices.start("Phone vault", { phone: true });
	await devices.connectBoth(laptop, phone, account);
	syncPluginsOn(laptop);
	syncPluginsOn(phone);
	await laptop.app.vault.adapter.write(inConfig(laptop, PLUGIN_DATA), '{"from":"start"}');
	await carry(devices, laptop, phone, account, PLUGIN_DATA, '{"from":"start"}');
	return { devices, account, laptop, phone };
}

/** Syncs `from`, whose `path` now holds `text`, then `to`, and resolves once `to` holds it too. */
async function carry(
	devices: PluginDevices,
	from: PluginDevice,
	to: PluginDevice,
	account: FakeDropboxAccount,
	path: string,
	text: string,
): Promise<void> {
	from.runCommand("sync-now");
	await vi.waitFor(() => expect(configOnRemote(account, path)).toBe(text), PLUGIN_WAIT);
	await devices.settle();
	to.runCommand("sync-now");
	await vi.waitFor(async () => expect(await textOn(to, inConfig(to, path))).toBe(text), PLUGIN_WAIT);
}

/**
 * Changes `PLUGIN_DATA` to `THEIRS` on `other`, then to `MINE` on
 * `finder`, and syncs them in that order: `finder` finds the conflict,
 * keeps `MINE` and takes `THEIRS`.
 */
async function conflictOn(devices: PluginDevices, finder: PluginDevice, other: PluginDevice, account: FakeDropboxAccount) {
	await other.app.vault.adapter.write(inConfig(other, PLUGIN_DATA), THEIRS);
	other.runCommand("sync-now");
	await vi.waitFor(() => expect(configOnRemote(account, PLUGIN_DATA)).toBe(THEIRS), PLUGIN_WAIT);
	await devices.settle();
	await finder.app.vault.adapter.write(inConfig(finder, PLUGIN_DATA), MINE);
	finder.runCommand("sync-now");
	await vi.waitFor(async () => expect(await textOn(finder, inConfig(finder, PLUGIN_DATA))).toBe(THEIRS), PLUGIN_WAIT);
	await synced(finder);
}

describe("the configuration folder in sync", { timeout: DEVICE_TEST_TIMEOUT_MS }, () => {
	it("tells to restart once a plugin's data.json arrives new and changed, and once community-plugins.json does", async () => {
		const { devices, account, laptop, phone } = await bothSyncingPlugins();
		expect(restartNotices(phone)).toBe(1);

		await laptop.app.vault.adapter.write(inConfig(laptop, PLUGIN_DATA), '{"from":"changed"}');
		await carry(devices, laptop, phone, account, PLUGIN_DATA, '{"from":"changed"}');
		expect(restartNotices(phone)).toBe(2);
		await laptop.app.vault.adapter.write(inConfig(laptop, COMMUNITY_PLUGINS), '["other-plugin"]');
		await carry(devices, laptop, phone, account, COMMUNITY_PLUGINS, '["other-plugin"]');

		expect(restartNotices(phone)).toBe(3);
		// Sending its own configuration changes nothing on the laptop.
		await synced(laptop);
		expect(restartNotices(laptop)).toBe(0);
	});

	it("keeps the local version on a conflict, and brings it back with Restore local in the Sync window", async () => {
		const { devices, account, laptop, phone } = await bothSyncingPlugins();
		await conflictOn(devices, laptop, phone, account);
		const noticesBefore = restartNotices(laptop);

		laptop.runCommand("show-conflicts");
		await vi.waitFor(() => expect(lastSyncWindow(laptop).textContent).toContain(strings.keptConfigurations), PLUGIN_WAIT);
		expect(lastSyncWindow(laptop).textContent).toContain(PLUGIN_DATA);
		buttonIn(lastSyncWindow(laptop), strings.restoreLocal).click();

		await vi.waitFor(async () => expect(await textOn(laptop, inConfig(laptop, PLUGIN_DATA))).toBe(MINE), PLUGIN_WAIT);
		await vi.waitFor(() => expect(configOnRemote(account, PLUGIN_DATA)).toBe(MINE), PLUGIN_WAIT);
		// The version restored is no longer kept, and the user's own choice tells no restart.
		await vi.waitFor(() => expect(lastSyncWindow(laptop).textContent).not.toContain(strings.keptConfigurations), PLUGIN_WAIT);
		await synced(laptop);
		expect(restartNotices(laptop)).toBe(noticesBefore);
	});

	it("brings the local version back through the command's list, on a phone fitted for it", async () => {
		const { devices, account, laptop, phone } = await bothSyncingPlugins();
		await conflictOn(devices, phone, laptop, account);
		const noticesBefore = restartNotices(phone);

		phone.runCommand("restore-local-configuration");
		/** The suggest windows the phone opened: the command's list only. */
		const lists = () => phone.windowsOpened().filter((modal) => modal instanceof phone.obsidian.SuggestModal);
		await vi.waitFor(() => expect(lists()).toHaveLength(1), PLUGIN_WAIT);
		// Obsidian draws a suggest window's items and calls these methods; the fake leaves that to the test.
		// Not covered: typing a query, nor what Obsidian does around the choice.
		const list = lists()[0] as unknown as RestoreConfigurationModal;
		expect(list.modalEl.classList).toContain("seamsync-phone");
		const [kept, ...others] = list.getSuggestions("");
		if (kept === undefined) throw new Error("no kept version listed");
		expect(others).toEqual([]);
		const item = phone.root.createDiv();
		list.renderSuggestion(kept, item);
		expect(item.textContent).toContain(PLUGIN_DATA);
		list.onChooseSuggestion(kept);

		await vi.waitFor(async () => expect(await textOn(phone, inConfig(phone, PLUGIN_DATA))).toBe(MINE), PLUGIN_WAIT);
		await synced(phone);
		expect(restartNotices(phone)).toBe(noticesBefore);
		// The version restored is no longer kept: the command now has nothing to list.
		phone.runCommand("restore-local-configuration");
		await vi.waitFor(() => expect(phone.notices()).toContain(strings.noKeptConfiguration), PLUGIN_WAIT);
	});
});
