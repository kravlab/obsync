// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import ObsyncPlugin from "../src/main";
import type { HttpRequest } from "../src/providers/dropbox/http";
import { selectStrings } from "../src/ui/i18n/strings";
import { FakeDropbox, json, type FakeDropboxAccount } from "./fakes/fake-dropbox";
import { Notice, answerRequestsWith, type Plugin as FakePlugin } from "./fakes/obsidian";
import { FakeApp } from "./fakes/obsidian-app";
import {
	PLUGIN_WAIT,
	RequestsUnderWay,
	buttonIn,
	connectThroughSettings,
	logIn as logInAs,
	pluginManifest,
	runCommand,
} from "./support/plugin-run";

const strings = selectStrings("en");

/** The app key the test build carries (vitest.config.mjs). */
const APP_KEY = "test-app-key";

/** The plugins started by a test, unloaded after it. */
const started: FakePlugin[] = [];

/** The requests to the fake service of the running test. */
let requests: RequestsUnderWay;

/** The browser the connect window opens pages in: it opens nothing, keeping the pages asked for. */
let opened: MockInstance<(url?: string | URL) => Window | null>;

beforeEach(() => {
	requests = new RequestsUnderWay();
	opened = vi.spyOn(window, "open").mockImplementation(() => null);
});

afterEach(async () => {
	for (const plugin of started.splice(0)) plugin.unload();
	// A sync under way when the plugin unloads finishes its requests; nothing of it may reach the next test.
	await requests.settle();
	document.body.replaceChildren();
	vi.restoreAllMocks();
});

/** Makes `requestUrl` reach `dropbox`, which takes the plugin's requests as the Dropbox provider sends them. */
function answerWith(dropbox: FakeDropbox): void {
	answerRequestsWith(requests.counting((request) => dropbox.requestUrl(request as HttpRequest)));
}

/** Starts the plugin in `app` and makes the layout ready; returns it as the fake Plugin it runs on. */
async function startPlugin(app: FakeApp): Promise<FakePlugin> {
	const plugin = new ObsyncPlugin(app as never, pluginManifest(app) as never);
	await plugin.onload();
	app.workspace.makeLayoutReady();
	const fake = plugin as unknown as FakePlugin;
	started.push(fake);
	return fake;
}

/** The button in the document with the text `text`; fails when there is none. */
function button(text: string): HTMLButtonElement {
	return buttonIn(document, text);
}

/** The authorize page the connect window opened last. */
function lastAuthorizeUrl(): string {
	const calls = opened.mock.calls;
	return String(calls[calls.length - 1]?.[0] ?? "");
}

/** Logs in on the open connect window as `account` approves it on `dropbox`'s page. */
async function logIn(dropbox: FakeDropbox, account: FakeDropboxAccount): Promise<void> {
	await logInAs({ root: document.body, dropbox, account, lastOpened: lastAuthorizeUrl });
}

/**
 * Connects through the settings tab and the connect window, as the user
 * does: Connect, Open Dropbox, the code `dropbox` shows `account`, then
 * a new Remote named after the vault.
 */
async function connect(plugin: FakePlugin, dropbox: FakeDropbox, account: FakeDropboxAccount): Promise<void> {
	await connectThroughSettings({
		root: document.body,
		dropbox,
		account,
		lastOpened: lastAuthorizeUrl,
		plugin,
		notices: () => Notice.shown,
	});
}

/** A plugin started on a vault holding one note, with a fake Dropbox account to connect to. */
async function startedWithNote() {
	const dropbox = new FakeDropbox(APP_KEY);
	const account = dropbox.addAccount("account-1");
	answerWith(dropbox);
	const app = new FakeApp("My vault");
	app.vault.seed("note.md", "hello");
	const plugin = await startPlugin(app);
	/** What the status bar item says now. */
	const status = (): string => plugin.statusBarItems[0]?.textContent ?? "";
	return { dropbox, account, plugin, status };
}

describe("the plugin unloaded before Obsidian's layout is ready", () => {
	it("starts no engine and listens for nothing once the layout gets ready", async () => {
		const app = new FakeApp("My vault");
		const plugin = new ObsyncPlugin(app as never, pluginManifest(app) as never);
		await plugin.onload();
		(plugin as unknown as FakePlugin).unload();
		const documentListeners = vi.spyOn(document, "addEventListener");
		const windowListeners = vi.spyOn(window, "addEventListener");
		const vaultListeners = vi.spyOn(app.vault, "on");
		const timers = vi.spyOn(window, "setTimeout");

		app.workspace.makeLayoutReady();
		// Anything started would have run by the next task.
		await new Promise((resolve) => window.setTimeout(resolve, 0));

		expect(documentListeners).not.toHaveBeenCalled();
		expect(windowListeners).not.toHaveBeenCalled();
		expect(vaultListeners).not.toHaveBeenCalled();
		expect(timers).toHaveBeenCalledTimes(1);
	});

	it("draws no settings tab once unloaded while onload was waiting", async () => {
		const app = new FakeApp("My vault");
		const plugin = new ObsyncPlugin(app as never, pluginManifest(app) as never);

		const loading = plugin.onload();
		(plugin as unknown as FakePlugin).unload();
		await loading;

		expect((plugin as unknown as FakePlugin).settingTabs[0]?.containerEl.childElementCount).toBe(0);
	});
});

describe("the plugin after connecting", () => {
	it("syncs at once after a new Connection, so the First sync preview opens", async () => {
		const { dropbox, account, plugin } = await startedWithNote();

		await connect(plugin, dropbox, account);

		await vi.waitFor(() => button(strings.firstSyncStart), PLUGIN_WAIT);
	});

	it("syncs at once after a login again ends a pause for Reconnect needed", async () => {
		const { dropbox, account, plugin, status } = await startedWithNote();
		await connect(plugin, dropbox, account);
		await vi.waitFor(() => button(strings.firstSyncStart), PLUGIN_WAIT);
		button(strings.firstSyncStart).click();
		await vi.waitFor(() => expect(status()).toContain(strings.statusSynced), PLUGIN_WAIT);
		// Dropbox refuses the next request's login, as for a revoked app.
		dropbox.interceptions.push(json(401, { error_summary: "invalid_access_token/", error: { ".tag": "invalid_access_token" } }));
		runCommand(plugin, "sync-now");
		await vi.waitFor(() => expect(status()).toContain(strings.statusReconnectNeeded), PLUGIN_WAIT);

		runCommand(plugin, "reconnect");
		await logIn(dropbox, account);

		await vi.waitFor(() => expect(Notice.shown).toContain(strings.noticeReconnected), PLUGIN_WAIT);
		await vi.waitFor(() => expect(status()).toContain(strings.statusSynced), PLUGIN_WAIT);
		// The refused login is told in one notice only.
		// The vault was synced before, so logging in again opens no First sync preview.
		expect(Notice.shown.filter((message) => message === strings.noticeReconnectNeeded)).toHaveLength(1);
		expect(() => button(strings.firstSyncStart)).toThrow(/no button/);
	});
});
