// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import { fill } from "../../src/ui/i18n/fill";
import { selectStrings } from "../../src/ui/i18n/strings";
import {
	bytesOn,
	fileOn,
	filesOn,
	lastSyncWindow,
	remoteBytes,
	remoteText,
	selectedTab,
	syncWindows,
	tabLines,
	textOn,
	useDevices,
} from "./plugin-devices";
import { PLUGIN_WAIT } from "./plugin-run";
import { DEVICE_TEST_TIMEOUT_MS } from "./timeouts";

const strings = selectStrings("en");

const newDevices = useDevices();

describe("plugin devices in one test", { timeout: DEVICE_TEST_TIMEOUT_MS }, () => {
	it("keeps each device's notices to itself", async () => {
		const { devices } = newDevices();
		const laptop = await devices.start("Laptop vault");
		const phone = await devices.start("Phone vault");

		// With no local configuration version kept, the command only says so in a notice.
		laptop.runCommand("restore-local-configuration");

		await expect.poll(() => laptop.notices(), PLUGIN_WAIT).toContain(strings.noKeptConfiguration);
		expect(phone.notices()).not.toContain(strings.noKeptConfiguration);
	});

	it("shows each device's windows in its own element", async () => {
		const { devices } = newDevices();
		const laptop = await devices.start("Laptop vault");
		const phone = await devices.start("Phone vault");

		laptop.runCommand("open-sync-window");

		expect(laptop.root.textContent).toContain(strings.syncWindowTitle);
		expect(phone.root.textContent).not.toContain(strings.syncWindowTitle);
		// Not connected, the window's button connects.
		expect(laptop.button(strings.connect)).toBeInstanceOf(HTMLButtonElement);
		expect(() => phone.button(strings.connect)).toThrow(/no button/);
	});

	it("tells each device's status: the status bar item's text, on a phone the ribbon icon's tooltip", async () => {
		const { devices } = newDevices();

		const laptop = await devices.start("Laptop vault");
		const phone = await devices.start("Phone vault", { phone: true });

		await vi.waitFor(() => expect(laptop.status()).toContain(strings.statusNotConnected), PLUGIN_WAIT);
		await vi.waitFor(() => expect(phone.status()).toContain(strings.statusNotConnected), PLUGIN_WAIT);
		expect(phone.plugin.statusBarItems).toHaveLength(0);
	});

	it("plays a phone on one device only", async () => {
		const { devices } = newDevices();
		const laptop = await devices.start("Laptop vault");
		const phone = await devices.start("Phone vault", { phone: true });

		// What the plugin itself does with it (the `seamsync-phone` class) is checked with the Sync window's tests.
		expect(phone.obsidian.Platform.isPhone).toBe(true);
		expect(laptop.obsidian.Platform.isPhone).toBe(false);
	});

	it("seeds each device's vault with its own files, binary ones included, as its own module's files", async () => {
		const { devices } = newDevices();
		const image = new Uint8Array([0x89, 0x50, 0xff, 0x00]).buffer;

		const laptop = await devices.start("Laptop vault", { files: { "note.md": "hello", "photo.png": image } });
		const phone = await devices.start("Phone vault");

		expect(new TextDecoder().decode(await laptop.app.vault.adapter.readBinary("note.md"))).toBe("hello");
		expect([...new Uint8Array(await laptop.app.vault.adapter.readBinary("photo.png"))]).toEqual([0x89, 0x50, 0xff, 0x00]);
		expect(phone.app.vault.getFileByPath("note.md")).toBeNull();
		// The app is built from the device's own instance of the fake `obsidian` module, which its plugin imports too.
		expect(laptop.app.vault.getFileByPath("note.md")).toBeInstanceOf(laptop.obsidian.TFile);
		expect(laptop.app.vault.getFileByPath("note.md")).not.toBeInstanceOf(phone.obsidian.TFile);
	});

	it("keeps each device's module instances apart when two start at once", async () => {
		const { devices } = newDevices();

		const [laptop, phone] = await Promise.all([
			devices.start("Laptop vault", { files: { "a.md": "a" } }),
			devices.start("Phone vault", { files: { "b.md": "b" } }),
		]);

		expect(laptop.obsidian).not.toBe(phone.obsidian);
		expect(laptop.app.vault.getFileByPath("a.md")).toBeInstanceOf(laptop.obsidian.TFile);
		expect(phone.app.vault.getFileByPath("b.md")).toBeInstanceOf(phone.obsidian.TFile);
	});

	it("sends every device's requests to the one fake Dropbox", async () => {
		const { dropbox, devices } = newDevices();
		const laptop = await devices.start("Laptop vault");
		const phone = await devices.start("Phone vault");
		const before = dropbox.requests.length;
		const request = { url: "https://api.dropboxapi.com/2/users/get_current_account", method: "POST", throw: false };

		await laptop.obsidian.requestUrl(request);
		await phone.obsidian.requestUrl(request);

		expect(dropbox.requests.length - before).toBe(2);
	});

	it("keeps the windows each device opened, closed ones included, by title if asked", async () => {
		const { devices } = newDevices();
		const laptop = await devices.start("Laptop vault");
		const phone = await devices.start("Phone vault");

		laptop.runCommand("open-sync-window");
		laptop.runCommand("show-activity");

		// The second command's window took the place of the first, which is kept though closed.
		const opened = laptop.windowsOpened();
		expect(opened.map((modal) => modal.titleEl.textContent)).toEqual([strings.syncWindowTitle, strings.syncWindowTitle]);
		expect(opened.map((modal) => modal.modalEl.isConnected)).toEqual([false, true]);
		expect(laptop.windowsOpened(strings.syncWindowTitle)).toHaveLength(2);
		expect(laptop.windowsOpened(strings.guardTitle)).toEqual([]);
		expect(phone.windowsOpened()).toEqual([]);
	});

	it("reads the Sync window a device opened last: its shown tab and that tab's lines; fails when none is open", async () => {
		const { devices } = newDevices();
		const laptop = await devices.start("Laptop vault");

		expect(syncWindows(laptop)).toEqual([]);
		expect(() => lastSyncWindow(laptop)).toThrow(/no Sync window/);
		laptop.runCommand("open-sync-window");
		const first = lastSyncWindow(laptop);
		laptop.runCommand("show-activity");

		expect(syncWindows(laptop)).toEqual([lastSyncWindow(laptop)]);
		expect(lastSyncWindow(laptop)).not.toBe(first);
		expect(selectedTab(laptop)).toBe(strings.tabActivity);
		// The status shown at start is the activity log's only event so far.
		expect(tabLines(laptop)).toEqual([expect.stringContaining(strings.statusNotConnected)]);
	});

	it("counts each device's own requests", async () => {
		const { devices } = newDevices();
		const laptop = await devices.start("Laptop vault");
		const phone = await devices.start("Phone vault");
		const [laptopBefore, phoneBefore] = [laptop.requestCount(), phone.requestCount()];
		const request = { url: "https://api.dropboxapi.com/2/users/get_current_account", method: "POST", throw: false };

		await laptop.obsidian.requestUrl(request);
		await laptop.obsidian.requestUrl(request);
		await phone.obsidian.requestUrl(request);

		expect(laptop.requestCount() - laptopBefore).toBe(2);
		expect(phone.requestCount() - phoneBefore).toBe(1);
	});

	it("connects two devices to the first one's Remote, each through its First sync, and reads the Remote's bytes", async () => {
		const { dropbox, devices } = newDevices();
		const account = dropbox.addAccount("account-1");
		const laptop = await devices.start("Laptop vault", { files: { "note.md": "hello" } });
		const phone = await devices.start("Phone vault", { phone: true });

		await devices.connectBoth(laptop, phone, account);

		expect(laptop.status()).toContain(strings.statusSynced);
		expect(phone.status()).toContain(strings.statusSynced);
		expect(await textOn(phone, "note.md")).toBe("hello");
		expect(remoteBytes(account, "Laptop vault", "note.md")).toEqual([...new TextEncoder().encode("hello")]);
		expect(remoteBytes(account, "Laptop vault", "missing.md")).toBeNull();
		expect(remoteBytes(account, "Phone vault", "note.md")).toBeNull();
		expect(remoteText(account, "Laptop vault", "note.md")).toBe("hello");
		expect(remoteText(account, "Laptop vault", "missing.md")).toBeNull();
	});

	it("connects a device to a new Remote, and another to it by name under its own device name, both through their First sync", async () => {
		const { dropbox, devices } = newDevices();
		const account = dropbox.addAccount("account-1");
		const laptop = await devices.start("Laptop vault", { files: { "note.md": "hello" } });
		const phone = await devices.start("Phone vault", { phone: true });

		await devices.connect(laptop, account);
		await devices.startFirstSync(laptop);
		await devices.connect(phone, account, { useFolder: "Laptop vault", deviceName: "Pocket" });
		await devices.startFirstSync(phone);

		expect(laptop.notices()).toContain(strings.noticeConnected);
		expect(laptop.root.textContent).toContain(fill(strings.settingsConnectedAs, { device: "Laptop vault" }));
		await vi.waitFor(
			() => expect(phone.root.textContent).toContain(fill(strings.settingsConnectedAs, { device: "Pocket" })),
			PLUGIN_WAIT,
		);
		expect(phone.status()).toContain(strings.statusSynced);
		expect(await bytesOn(phone, "note.md")).toEqual([...new TextEncoder().encode("hello")]);
	});

	it("restarts a device on what outlives a restart, running a step while it is closed", async () => {
		const { devices } = newDevices();
		const before = await devices.start("Phone vault", { phone: true, files: { "note.md": "hello" } });
		let whileClosed: { unloaded: boolean; shown: boolean } | undefined;

		const after = await devices.restart(before, () => {
			whileClosed = { unloaded: before.plugin.unloaded, shown: before.root.isConnected };
			return Promise.resolve();
		});

		expect(whileClosed).toEqual({ unloaded: true, shown: false });
		expect(after.plugin).not.toBe(before.plugin);
		expect(after.obsidian).not.toBe(before.obsidian);
		expect(after.app.vault.getName()).toBe("Phone vault");
		expect(after.obsidian.Platform.isPhone).toBe(true);
		expect(await textOn(after, "note.md")).toBe("hello");
		expect(after.status()).toContain(strings.statusNotConnected);
		await expect(devices.restart(before)).rejects.toThrow(/not a running device/);
	});

	it("finds a device's file, and fails for one it does not have", async () => {
		const { devices } = newDevices();

		const laptop = await devices.start("Laptop vault", { files: { "note.md": "hello" } });

		expect(fileOn(laptop, "note.md").path).toBe("note.md");
		expect(() => fileOn(laptop, "missing.md")).toThrow(/no file missing.md/);
		expect(await bytesOn(laptop, "missing.md")).toBeNull();
	});

	it("reads a device's text file, and lists its vault's files sorted, without folders or hidden paths", async () => {
		const { devices } = newDevices();

		const laptop = await devices.start("Laptop vault", { files: { "notes/b.md": "b", "a.md": "a" } });
		await laptop.app.vault.adapter.write(`${laptop.app.vault.configDir}/app.json`, "{}");

		expect(await textOn(laptop, "notes/b.md")).toBe("b");
		expect(await textOn(laptop, "missing.md")).toBeNull();
		expect(filesOn(laptop)).toEqual(["a.md", "notes/b.md"]);
	});

	it("keeps the page a connect window opened last, and opens none", async () => {
		const { devices } = newDevices();

		const shown = window.open("https://example.com/authorize");

		expect(shown).toBeNull();
		expect(devices.lastOpened()).toBe("https://example.com/authorize");
	});

	it("unloads every device, takes all of its elements out of the document and gives the window its open back", async () => {
		const { devices } = newDevices();
		const laptop = await devices.start("Laptop vault");
		const phone = await devices.start("Phone vault");

		await devices.unloadAll();

		for (const device of [laptop, phone]) {
			expect(device.plugin.unloaded).toBe(true);
			expect(device.root.isConnected).toBe(false);
			expect(device.app.workspace.containerEl.isConnected).toBe(false);
		}
		expect(document.body.childElementCount).toBe(0);
		// Read through Reflect: the method is only looked at, never called unbound.
		expect(vi.isMockFunction(Reflect.get(window, "open"))).toBe(false);
	});
});
