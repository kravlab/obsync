/**
 * Several devices in one jsdom test, each the whole plugin over a vault of
 * its own, all on one fake Dropbox (spec of the check automation, "Test
 * infrastructure"). Unlike `TestDevice` and `ConnectingDevice`, which run
 * the engine over fakes of its ports, a device here is the plugin as
 * Obsidian loads it.
 *
 * Each device imports its own instance of the fake `obsidian` module and of
 * the plugin, so its notices, platform flags and `requestUrl` handler are
 * its own, and it shows its windows in an element of its own. Hence:
 *
 * - a test reaches a device's fake through `device.obsidian`; a static
 *   `import … from "../fakes/obsidian"` is another instance, which no
 *   device uses;
 * - the setup file's reset does not reach the devices' instances, so a
 *   device lives within its test: started in it, unloaded after it;
 * - the devices share the one document and window: an event on either,
 *   such as `online`, reaches every device, and the pages the connect
 *   window opens are kept in one list (`lastOpened`).
 */
import { afterEach, expect, vi, type MockInstance } from "vitest";
import type { HttpRequest } from "../../src/providers/dropbox/http";
import { selectStrings } from "../../src/ui/i18n/strings";
import { FakeDropbox, type FakeDropboxAccount } from "../fakes/fake-dropbox";
import type * as ObsidianFake from "../fakes/obsidian";
import type { FakeApp } from "../fakes/obsidian-app";
import {
	PLUGIN_WAIT,
	RequestsUnderWay,
	buttonIn,
	connectThroughSettings,
	pluginManifest,
	preloadPluginModules,
	runCommand,
	type ConnectChoice,
} from "./plugin-run";

/** The plugin's texts as the devices, set to English, show them. */
const strings = selectStrings("en");

/** One device: the plugin running in its app, and what it shows. */
export interface PluginDevice {
	/** This device's own instance of the fake `obsidian` module. */
	readonly obsidian: typeof ObsidianFake;
	/** The app the plugin runs in, with its vault. */
	readonly app: FakeApp;
	/** The plugin, as the fake Plugin it runs on. */
	readonly plugin: ObsidianFake.Plugin;
	/** The element this device's windows, ribbon icons and status bar items show in. */
	readonly root: HTMLElement;
	/** The messages of every notice this device showed, oldest first. */
	notices(): readonly string[];
	/** What the status bar item says now, or on a phone the ribbon icon's tooltip. */
	status(): string;
	/** The button of this device with the text `text`; fails when there is none. */
	button(text: string): HTMLButtonElement;
	/** Runs the command `id`, an editor command on the editor of `view`; fails when there is none, or when it is not offered now. */
	runCommand(id: string, view?: ObsidianFake.MarkdownView): void;
	/** How many requests this device has sent to the fake service so far. */
	requestCount(): number;
	/** Every window (modal) this device opened, oldest first, closed ones included; only those titled `title` if given. */
	windowsOpened(title?: string): ObsidianFake.Modal[];
}

/** How a device starts. */
export interface DeviceOptions {
	/** The files in its vault when Obsidian starts, by path: text or bytes. */
	readonly files?: Readonly<Record<string, string | ArrayBuffer>>;
	/** Whether it plays a phone (`Platform.isPhone`, `isMobile`). */
	readonly phone?: boolean;
}

/** The app key the test build carries (test/vitest.config.mjs), which the fake Dropbox expects. */
const APP_KEY = "test-app-key";

/**
 * Sets the calling test file up for devices: the plugin's modules loaded
 * before its first test, and every test's devices unloaded after it. Call
 * it at the top of the file; the function it returns gives the running
 * test its devices, on a fresh fake Dropbox.
 */
export function useDevices(): () => { dropbox: FakeDropbox; devices: PluginDevices } {
	preloadPluginModules();
	let current: PluginDevices | undefined;
	afterEach(async () => {
		await current?.unloadAll();
		current = undefined;
	});
	return () => {
		const dropbox = new FakeDropbox(APP_KEY);
		current = new PluginDevices(dropbox);
		return { dropbox, devices: current };
	};
}

/** The indexed file at `path` in `device`'s vault; fails when there is none. */
export function fileOn(device: PluginDevice, path: string): ObsidianFake.TFile {
	const file = device.app.vault.getFileByPath(path);
	if (file === null) throw new Error(`no file ${path} on the device of ${device.app.vault.getName()}`);
	return file;
}

/** The bytes of the file `path` in `device`'s vault, or null when there is none. */
export async function bytesOn(device: PluginDevice, path: string): Promise<number[] | null> {
	if (!(await device.app.vault.adapter.exists(path))) return null;
	return [...new Uint8Array(await device.app.vault.adapter.readBinary(path))];
}

/** The text of the file `path` in `device`'s vault, or null when there is none. */
export async function textOn(device: PluginDevice, path: string): Promise<string | null> {
	return (await device.app.vault.adapter.exists(path)) ? device.app.vault.adapter.read(path) : null;
}

/** The bytes `account` holds for `path` in the Remote folder `folder`, or null when it holds none. */
export function remoteBytes(account: FakeDropboxAccount, folder: string, path: string): number[] | null {
	const data = account.file(`/${folder}/${path}`);
	return data === undefined ? null : [...new Uint8Array(data)];
}

/** The text `account` holds for `path` in the Remote folder `folder`, or null when it holds none. */
export function remoteText(account: FakeDropboxAccount, folder: string, path: string): string | null {
	const bytes = remoteBytes(account, folder, path);
	return bytes === null ? null : new TextDecoder().decode(new Uint8Array(bytes));
}

/** The Sync windows open on `device`, oldest first: one, or none, since a new one takes the place of the one open. */
export function syncWindows(device: PluginDevice): HTMLElement[] {
	return [...device.root.querySelectorAll<HTMLElement>(".seamsync-sync-window")];
}

/** The Sync window `device` opened last; fails when none is open. */
export function lastSyncWindow(device: PluginDevice): HTMLElement {
	const windows = syncWindows(device);
	const last = windows[windows.length - 1];
	if (last === undefined) throw new Error("no Sync window is open");
	return last;
}

/** The label, its count included, of the tab the Sync window `device` opened last shows. */
export function selectedTab(device: PluginDevice): string {
	return lastSyncWindow(device).querySelector('[role="tab"][aria-selected="true"]')?.textContent ?? "";
}

/** The texts of the lines and items the shown tab of the Sync window `device` opened last lists. */
export function tabLines(device: PluginDevice): string[] {
	return [
		...lastSyncWindow(device).querySelectorAll(".seamsync-sync-body .seamsync-sync-line, .seamsync-sync-body .seamsync-sync-item"),
	].map((line) => line.textContent);
}

/** The paths of every file in `device`'s vault index, sorted; hidden paths, the configuration's included, are not in it. */
export function filesOn(device: PluginDevice): string[] {
	return device.app.vault
		.getAllLoadedFiles()
		.filter((entry) => entry instanceof device.obsidian.TFile)
		.map((file) => file.path)
		.sort();
}

/** The devices of one test, on one fake Dropbox. */
export class PluginDevices {
	/** Every device started, failed starts included, for `unloadAll` to clean up. */
	private readonly started: PluginDevice[] = [];
	/** The requests of every device to the fake service. */
	private readonly requests = new RequestsUnderWay();
	/** The last start, which the next one waits for: two starts at once would mix their module instances. */
	private starting: Promise<unknown> = Promise.resolve();
	/** The browser the connect windows open pages in: it opens nothing, keeping the pages asked for. */
	private readonly opened: MockInstance<(url?: string | URL) => Window | null>;

	/** @param dropbox the fake service every device's `requestUrl` reaches */
	constructor(private readonly dropbox: FakeDropbox) {
		this.opened = vi.spyOn(window, "open").mockImplementation(() => null);
	}

	/**
	 * Starts a device whose vault is named `vaultName`: fresh instances of
	 * the fake `obsidian` module and of the plugin, the vault seeded with
	 * `options.files`, the plugin loaded and the layout made ready. Starts
	 * run one after another, however they are called.
	 */
	start(vaultName: string, options: DeviceOptions = {}): Promise<PluginDevice> {
		const started = this.starting.then(() => this.load(vaultName, options));
		this.starting = started.catch(() => undefined);
		return started;
	}

	/**
	 * Restarts `device` as Obsidian restarts: its plugin unloads, its
	 * requests finish and its elements go, then `whileClosed` runs, then
	 * fresh module instances load the plugin again on a new app holding what
	 * outlives the restart (`FakeApp.persistFrom`), still a phone if it was
	 * one. Resolves with the restarted device; the old one is no longer
	 * this test's. Only the load waits for other starts: the unload happens
	 * at once, each device having its own module instances. The elements go
	 * even when unloading or waiting fails; when that or `whileClosed`
	 * fails, the device is gone and none takes its place.
	 */
	async restart(device: PluginDevice, whileClosed: () => Promise<void> = () => Promise.resolve()): Promise<PluginDevice> {
		const index = this.started.indexOf(device);
		if (index < 0) throw new Error("not a running device of this test");
		this.started.splice(index, 1);
		try {
			device.plugin.unload();
			await this.settle();
		} finally {
			device.root.remove();
			device.app.workspace.containerEl.remove();
		}
		await whileClosed();
		const options = { phone: device.obsidian.Platform.isPhone };
		const restarted = this.starting.then(() => this.load(device.app.vault.getName(), options, device.app));
		this.starting = restarted.catch(() => undefined);
		return restarted;
	}

	/**
	 * Connects `device` through its settings tab as `account` approves the
	 * login, to the Remote `choice` names. The device is named after its
	 * vault unless `choice` names it, so the devices of a test differ.
	 */
	connect(device: PluginDevice, account: FakeDropboxAccount, choice: ConnectChoice = {}): Promise<void> {
		const run = {
			root: device.root,
			dropbox: this.dropbox,
			account,
			lastOpened: () => this.lastOpened(),
			plugin: device.plugin,
			notices: () => device.notices(),
		};
		return connectThroughSettings(run, { deviceName: device.app.vault.getName(), ...choice });
	}

	/** Starts the First sync `device`'s preview offers, and resolves once the device says it is synced. */
	async startFirstSync(device: PluginDevice): Promise<void> {
		await vi.waitFor(() => device.button(strings.firstSyncStart), PLUGIN_WAIT);
		device.button(strings.firstSyncStart).click();
		await vi.waitFor(() => expect(device.status()).toContain(strings.statusSynced), PLUGIN_WAIT);
	}

	/**
	 * Connects `first` to a new Remote named after its vault and `second` to
	 * that Remote, each as `account` approves and through its First sync,
	 * `first` before `second`.
	 */
	async connectBoth(first: PluginDevice, second: PluginDevice, account: FakeDropboxAccount): Promise<void> {
		await this.connect(first, account);
		await this.startFirstSync(first);
		await this.connect(second, account, { useFolder: first.app.vault.getName() });
		await this.startFirstSync(second);
	}

	/** The page a connect window opened last, of any device; "" when none was. */
	lastOpened(): string {
		const calls = this.opened.mock.calls;
		return String(calls[calls.length - 1]?.[0] ?? "");
	}

	/** Resolves once no request of any device has been under way for two checks in a row; fails after `PLUGIN_WAIT`. */
	settle(): Promise<void> {
		return this.requests.settle();
	}

	/**
	 * Unloads every device, waits for the requests a sync under way still
	 * makes, takes the devices' elements out of the document and gives the
	 * window its own `open` back, so nothing of them reaches the next test.
	 * The elements go even when unloading or waiting fails; that failure is
	 * thrown after.
	 */
	async unloadAll(): Promise<void> {
		const devices = this.started.splice(0);
		const failures: unknown[] = [];
		for (const device of devices) {
			try {
				device.plugin.unload();
			} catch (failure) {
				failures.push(failure);
			}
		}
		try {
			await this.settle();
		} catch (failure) {
			failures.push(failure);
		} finally {
			for (const device of devices) {
				device.root.remove();
				device.app.workspace.containerEl.remove();
			}
			this.opened.mockRestore();
		}
		if (failures.length > 0) throw new AggregateError(failures, "unloading the devices failed");
	}

	/**
	 * Loads one device, as `start` describes, or as `restart` does when
	 * `before` is the app it had; the device is kept before its plugin
	 * loads, so a failed load is cleaned up too.
	 */
	private async load(vaultName: string, options: DeviceOptions, before?: FakeApp): Promise<PluginDevice> {
		// The next imports load new instances of every module, the plugin's own `obsidian` import included.
		vi.resetModules();
		const obsidian = await import("../fakes/obsidian");
		const { FakeApp } = await import("../fakes/obsidian-app");
		const { default: SeamsyncPlugin } = await import("../../src/main");
		if (options.phone === true) Object.assign(obsidian.Platform, { isPhone: true, isMobile: true, isDesktop: false });
		let sent = 0;
		obsidian.answerRequestsWith(
			this.requests.counting((request) => {
				sent += 1;
				return this.dropbox.requestUrl(request as HttpRequest);
			}),
		);
		// On this device's own module, which goes with the device: nothing to restore.
		const opened = vi.spyOn(obsidian.Modal.prototype, "open");
		const root = document.body.createDiv();
		obsidian.showInto(root);
		const app = new FakeApp(vaultName);
		if (before !== undefined) app.persistFrom(before);
		for (const [path, content] of Object.entries(options.files ?? {})) app.vault.seed(path, content);
		const loaded = new SeamsyncPlugin(app as never, pluginManifest(app) as never);
		const plugin = loaded as unknown as ObsidianFake.Plugin;
		const device: PluginDevice = {
			obsidian,
			app,
			plugin,
			root,
			notices: () => obsidian.Notice.shown,
			// On a phone the status is the ribbon icon's tooltip, there being no status bar.
			status: () => plugin.statusBarItems[0]?.textContent ?? plugin.ribbonIcons[0]?.getAttribute("aria-label") ?? "",
			button: (text) => buttonIn(root, text),
			runCommand: (id, view) => runCommand(plugin, id, view),
			requestCount: () => sent,
			windowsOpened: (title) =>
				// The spy's `this` is each modal opened, which its type does not tell.
				(opened.mock.contexts as ObsidianFake.Modal[]).filter((modal) => title === undefined || modal.titleEl.textContent === title),
		};
		this.started.push(device);
		await loaded.onload();
		app.workspace.makeLayoutReady();
		return device;
	}
}
