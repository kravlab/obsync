// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConnectionService } from "../../src/engine/connection";
import { DEFAULT_REMOTE_SETTINGS, type DeviceRecord, type RemoteSettings } from "../../src/engine/remote-metadata";
import { ObsidianConfigurationCategoriesStore } from "../../src/obsidian/configuration-categories-store";
import { ObsidianDeletionGuardStore } from "../../src/obsidian/deletion-guard-store";
import { ObsidianRequestLimitStore } from "../../src/obsidian/request-limit-store";
import { ObsidianScheduleStore } from "../../src/obsidian/schedule-store";
import { fill } from "../../src/ui/i18n/fill";
import { selectStrings } from "../../src/ui/i18n/strings";
import { ObsyncSettingTab } from "../../src/ui/settings-tab";
import { Notice, Plugin } from "../fakes/obsidian";
import { FakeApp } from "../fakes/obsidian-app";

const strings = selectStrings("en");

afterEach(() => {
	document.body.replaceChildren();
	vi.restoreAllMocks();
});

/**
 * The settings tab of a connected device named "Laptop", that knows the
 * default shared settings, drawn into the document; the connection service
 * answers as `overrides` say, and Apply calls `changeSettings`.
 */
async function connectedTab(
	overrides: Partial<ConnectionService> = {},
	changeSettings: (base: RemoteSettings, wanted: RemoteSettings) => Promise<void> = () => Promise.resolve(),
): Promise<ObsyncSettingTab> {
	const app = new FakeApp();
	const service: ConnectionService = {
		showStatus: () => Promise.resolve(),
		currentDevice: () => Promise.resolve({ id: "laptop-id", name: "Laptop" }),
		startAuthorization: () => Promise.reject(new Error("unused")),
		disconnect: () => Promise.resolve({ kind: "disconnected" }),
		renameDevice: () => Promise.resolve({ kind: "renamed" }),
		otherDevices: () => Promise.resolve([]),
		forgetDevice: () => Promise.resolve({ kind: "forgotten" }),
		sharedSettings: () => Promise.resolve(DEFAULT_REMOTE_SETTINGS),
		...overrides,
	};
	const tab = new ObsyncSettingTab(
		app as never,
		new Plugin(app, { id: "obsync", version: "0.1.0" }) as never,
		service,
		strings,
		() => undefined,
		() => undefined,
		changeSettings,
		new ObsidianRequestLimitStore(app as never),
		new ObsidianScheduleStore(app as never),
		new ObsidianDeletionGuardStore(app as never),
		new ObsidianConfigurationCategoriesStore(app as never),
	);
	await tab.reload();
	document.body.appendChild(tab.containerEl);
	return tab;
}

/** Presses the button with the text `text`; fails when there is none. */
function press(text: string): void {
	const found = [...document.querySelectorAll("button")].find((candidate) => candidate.textContent === text);
	if (found === undefined) throw new Error(`no button ${text}`);
	found.click();
}

describe("the settings tab's Disconnect", () => {
	it("tells the user it is disconnected", async () => {
		await connectedTab({ disconnect: () => Promise.resolve({ kind: "disconnected" }) });

		press(strings.disconnect);

		await vi.waitFor(() => expect(Notice.shown).toEqual([strings.noticeDisconnected]));
	});

	it("tells the user a Disconnect that failed unexpectedly, and logs it, instead of leaving it unhandled", async () => {
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const bug = new TypeError("boom");
		await connectedTab({ disconnect: () => Promise.reject(bug) });

		press(strings.disconnect);

		await vi.waitFor(() => expect(Notice.shown).toEqual([strings.noticeDisconnectFailed]));
		expect(consoleError).toHaveBeenCalledWith("obsync: disconnecting failed", bug);
	});
});

/** The settings row named `name`; fails when there is none. */
function row(name: string): HTMLElement {
	const found = [...document.querySelectorAll<HTMLElement>(".setting-item")].find(
		(candidate) => candidate.querySelector(".setting-item-name")?.textContent === name,
	);
	if (found === undefined) throw new Error(`no row ${name}`);
	return found;
}

/** Types `value` into the field of the row named `name`, as the user would. */
function type(name: string, value: string): void {
	const field = row(name).querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input, textarea, select");
	if (field === null) throw new Error(`no field in ${name}`);
	field.value = value;
	field.dispatchEvent(new Event(field instanceof HTMLSelectElement ? "change" : "input"));
}

describe("the settings tab's shared settings", () => {
	it("applies the typed values to all devices", async () => {
		const changeSettings = vi.fn(() => Promise.resolve());
		await connectedTab({}, changeSettings);

		type(strings.settingsNamePolicy, "encodeReversibly");
		type(strings.settingsTextExtensions, "md, txt, org");
		type(strings.settingsIgnoreList, "Archive/\n*.tmp");
		type(strings.settingsSizeCeiling, "50");
		press(strings.settingsApplyShared);

		expect(changeSettings).toHaveBeenCalledWith(DEFAULT_REMOTE_SETTINGS, {
			namePolicy: "encodeReversibly",
			textExtensions: ["md", "txt", "org"],
			ignoreList: ["Archive/", "*.tmp"],
			sizeCeilingBytes: 50 * 1024 * 1024,
		});
	});

	it("makes a second change from the values applied first, before its sync is done", async () => {
		const changeSettings = vi.fn((_base: RemoteSettings, _wanted: RemoteSettings) => new Promise<void>(() => undefined));
		await connectedTab({}, changeSettings);
		type(strings.settingsSizeCeiling, "200");
		press(strings.settingsApplyShared);

		type(strings.settingsSizeCeiling, "100");
		press(strings.settingsApplyShared);

		const raised = { ...DEFAULT_REMOTE_SETTINGS, sizeCeilingBytes: 200 * 1024 * 1024 };
		expect(changeSettings).toHaveBeenLastCalledWith(raised, DEFAULT_REMOTE_SETTINGS);
	});

	it("keeps the size limit when the typed one is not a whole number, and says why", async () => {
		const changeSettings = vi.fn(() => Promise.resolve());
		await connectedTab({}, changeSettings);

		type(strings.settingsSizeCeiling, "1.5");
		press(strings.settingsApplyShared);

		expect(row(strings.settingsSizeCeiling).textContent).toContain(strings.settingsSizeCeilingInvalid);
		expect(changeSettings).toHaveBeenCalledWith(DEFAULT_REMOTE_SETTINGS, DEFAULT_REMOTE_SETTINGS);
	});

	it("shows the settings a sync brought, when the user is not editing them", async () => {
		const brought = { ...DEFAULT_REMOTE_SETTINGS, ignoreList: ["Archive/"] };
		const sharedSettings = vi.fn().mockResolvedValueOnce(null).mockResolvedValue(brought);
		const tab = await connectedTab({ sharedSettings });

		await tab.refreshShared();

		expect(row(strings.settingsIgnoreList).querySelector("textarea")?.value).toBe("Archive/");
	});

	it("keeps the user's edits not applied yet when a sync brings settings", async () => {
		const brought = { ...DEFAULT_REMOTE_SETTINGS, ignoreList: ["Archive/"] };
		const sharedSettings = vi.fn().mockResolvedValueOnce(DEFAULT_REMOTE_SETTINGS).mockResolvedValue(brought);
		const changeSettings = vi.fn(() => Promise.resolve());
		const tab = await connectedTab({ sharedSettings }, changeSettings);
		type(strings.settingsSizeCeiling, "50");

		await tab.refreshShared();
		press(strings.settingsApplyShared);

		expect(changeSettings).toHaveBeenCalledWith(DEFAULT_REMOTE_SETTINGS, {
			...DEFAULT_REMOTE_SETTINGS,
			sizeCeilingBytes: 50 * 1024 * 1024,
		});
	});

	it("asks for a sync first while no sync has read them", async () => {
		await connectedTab({ sharedSettings: () => Promise.resolve(null) });

		expect(document.body.textContent).toContain(strings.settingsSharedUnknown);
		expect(document.body.textContent).not.toContain(strings.settingsApplyShared);
	});
});

describe("the settings tab's device name", () => {
	it("renames this device", async () => {
		const renameDevice = vi.fn(() => Promise.resolve({ kind: "renamed" as const }));
		await connectedTab({ renameDevice });

		type(strings.deviceName, "Work laptop");
		press(strings.rename);

		expect(renameDevice).toHaveBeenCalledWith("Work laptop");
	});

	it("tells the user a blank name is not taken", async () => {
		await connectedTab({ renameDevice: () => Promise.resolve({ kind: "emptyName" }) });

		type(strings.deviceName, "  ");
		press(strings.rename);

		await vi.waitFor(() => expect(Notice.shown).toEqual([strings.deviceNameInvalid]));
	});
});

describe("the settings tab's other devices", () => {
	const phone: DeviceRecord = { device: { id: "phone-id", name: "Phone" }, revision: "r1" };

	it("are read only when asked for, then listed by name", async () => {
		const otherDevices = vi.fn(() => Promise.resolve([phone]));
		await connectedTab({ otherDevices });
		expect(otherDevices).not.toHaveBeenCalled();

		press(strings.showDevices);

		await vi.waitFor(() => expect(row("Phone").textContent).toContain(strings.settingsDeviceDescription));
	});

	it("tells the user when they could not be read", async () => {
		await connectedTab({ otherDevices: () => Promise.reject(new Error("offline")) });

		press(strings.showDevices);

		await vi.waitFor(() => expect(document.body.textContent).toContain(strings.settingsDevicesUnavailable));
	});

	it("forget one once the user confirms, and tell it", async () => {
		const forgetDevice = vi.fn(() => Promise.resolve({ kind: "forgotten" as const }));
		await connectedTab({ otherDevices: () => Promise.resolve([phone]), forgetDevice });
		press(strings.showDevices);
		await vi.waitFor(() => row("Phone"));

		press(strings.forgetDevice);
		expect(forgetDevice).not.toHaveBeenCalled();
		const confirm = [...document.querySelectorAll("button")].filter((button) => button.textContent === strings.forgetDevice).at(-1);
		confirm?.click();

		await vi.waitFor(() => expect(Notice.shown).toEqual([fill(strings.noticeDeviceForgotten, { device: "Phone" })]));
		expect(forgetDevice).toHaveBeenCalledWith(phone);
	});

	it("keep one the user did not confirm forgetting", async () => {
		const forgetDevice = vi.fn(() => Promise.resolve({ kind: "forgotten" as const }));
		await connectedTab({ otherDevices: () => Promise.resolve([phone]), forgetDevice });
		press(strings.showDevices);
		await vi.waitFor(() => row("Phone"));

		press(strings.forgetDevice);
		press(strings.cancel);

		await Promise.resolve();
		expect(forgetDevice).not.toHaveBeenCalled();
		expect(Notice.shown).toEqual([]);
		expect(row("Phone")).toBeDefined();
	});
});
