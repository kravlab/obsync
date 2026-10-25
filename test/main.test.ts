// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import ObsyncPlugin from "../src/main";
import type { HttpRequest } from "../src/providers/dropbox/http";
import { selectStrings } from "../src/ui/i18n/strings";
import { FakeDropbox, json, type FakeDropboxAccount } from "./fakes/fake-dropbox";
import { Notice, answerRequestsWith, type Plugin as FakePlugin } from "./fakes/obsidian";
import { FakeApp } from "./fakes/obsidian-app";

const strings = selectStrings("en");

/** The app key the test build carries (vitest.config.mjs). */
const APP_KEY = "test-app-key";

/** How long a test waits for the plugin to get somewhere: a whole sync over the fake service included. */
const WAIT = { timeout: 5_000 } as const;

/** The plugins started by a test, unloaded after it. */
const started: FakePlugin[] = [];

/** How many requests to the fake service are under way. */
let inFlight = 0;

/** The browser the connect window opens pages in: it opens nothing, keeping the pages asked for. */
let opened: MockInstance<(url?: string | URL) => Window | null>;

beforeEach(() => {
	inFlight = 0;
	opened = vi.spyOn(window, "open").mockImplementation(() => null);
});

afterEach(async () => {
	for (const plugin of started.splice(0)) plugin.unload();
	// A sync under way when the plugin unloads finishes its requests; nothing of it may reach the next test.
	await settle();
	document.body.replaceChildren();
	vi.restoreAllMocks();
});

/** Resolves once no request has been under way for two checks in a row; fails after `WAIT`. */
async function settle(): Promise<void> {
	const step = 20;
	let quiet = 0;
	for (let waited = 0; quiet < 2; waited += step) {
		if (waited > WAIT.timeout) throw new Error(`requests still under way after ${WAIT.timeout} ms`);
		await new Promise((resolve) => window.setTimeout(resolve, step));
		quiet = inFlight === 0 ? quiet + 1 : 0;
	}
}

/** Makes `requestUrl` reach `dropbox`, which takes the plugin's requests as the Dropbox provider sends them. */
function answerWith(dropbox: FakeDropbox): void {
	answerRequestsWith(async (request) => {
		inFlight += 1;
		try {
			return await dropbox.requestUrl(request as HttpRequest);
		} finally {
			inFlight -= 1;
		}
	});
}

/** Starts the plugin in `app` and makes the layout ready; returns it as the fake Plugin it runs on. */
async function startPlugin(app: FakeApp): Promise<FakePlugin> {
	const manifest = { id: "obsync", version: "0.1.0", dir: `${app.vault.configDir}/plugins/obsync` };
	const plugin = new ObsyncPlugin(app as never, manifest as never);
	await plugin.onload();
	app.workspace.makeLayoutReady();
	const fake = plugin as unknown as FakePlugin;
	started.push(fake);
	return fake;
}

/** The button in the document with the text `text`; fails when there is none. */
function button(text: string): HTMLButtonElement {
	const found = [...document.querySelectorAll("button")].find((candidate) => candidate.textContent === text);
	if (found === undefined) throw new Error(`no button ${text}`);
	return found;
}

/** The text field of the settings row named `name`; fails when there is none. */
function field(name: string): HTMLInputElement {
	const row = [...document.querySelectorAll(".setting-item")].find(
		(candidate) => candidate.querySelector(".setting-item-name")?.textContent === name,
	);
	const input = row?.querySelector("input");
	if (input === null || input === undefined) throw new Error(`no field ${name}`);
	return input;
}

/** The authorize page the connect window opened last. */
function lastAuthorizeUrl(): string {
	const calls = opened.mock.calls;
	return String(calls[calls.length - 1]?.[0] ?? "");
}

/** Runs the command `id` of `plugin`; fails when there is none, or when it is not offered now. */
function runCommand(plugin: FakePlugin, id: string): void {
	const found = plugin.commands.find((candidate) => candidate.id === id);
	if (found === undefined) throw new Error(`no command ${id}`);
	if (found.callback !== undefined) {
		found.callback();
		return;
	}
	if (found.checkCallback?.(true) !== true) throw new Error(`command ${id} is not offered`);
	found.checkCallback(false);
}

/** Logs in on the open connect window as `account` approves it on `dropbox`'s page. */
async function logIn(dropbox: FakeDropbox, account: FakeDropboxAccount): Promise<void> {
	await vi.waitFor(() => button(strings.openDropbox), WAIT);
	button(strings.openDropbox).click();
	const code = field(strings.loginCode);
	code.value = dropbox.approve(lastAuthorizeUrl(), account);
	code.dispatchEvent(new Event("input"));
	button(strings.continue).click();
}

/**
 * Connects through the settings tab and the connect window, as the user
 * does: Connect, Open Dropbox, the code `dropbox` shows `account`, then
 * a new Remote named after the vault.
 */
async function connect(plugin: FakePlugin, dropbox: FakeDropbox, account: FakeDropboxAccount): Promise<void> {
	const tab = plugin.settingTabs[0];
	if (tab === undefined) throw new Error("no settings tab");
	document.body.appendChild(tab.containerEl);
	button(strings.connect).click();
	await logIn(dropbox, account);
	await vi.waitFor(() => button(strings.create), WAIT);
	button(strings.create).click();
	// A failure the window shows is the reason given when connecting does not finish.
	const shownFailure = (): string =>
		[...document.querySelectorAll(".obsync-message, .obsync-message-detail")].map((line) => line.textContent).join(" ");
	await vi.waitFor(() => expect(Notice.shown, shownFailure()).toContain(strings.noticeConnected), WAIT);
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
		const manifest = { id: "obsync", version: "0.1.0", dir: `${app.vault.configDir}/plugins/obsync` };
		const plugin = new ObsyncPlugin(app as never, manifest as never);
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
		const manifest = { id: "obsync", version: "0.1.0", dir: `${app.vault.configDir}/plugins/obsync` };
		const plugin = new ObsyncPlugin(app as never, manifest as never);

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

		await vi.waitFor(() => button(strings.firstSyncStart), WAIT);
	});

	it("syncs at once after a login again ends a pause for Reconnect needed", async () => {
		const { dropbox, account, plugin, status } = await startedWithNote();
		await connect(plugin, dropbox, account);
		await vi.waitFor(() => button(strings.firstSyncStart), WAIT);
		button(strings.firstSyncStart).click();
		await vi.waitFor(() => expect(status()).toContain(strings.statusSynced), WAIT);
		// Dropbox refuses the next request's login, as for a revoked app.
		dropbox.interceptions.push(json(401, { error_summary: "invalid_access_token/", error: { ".tag": "invalid_access_token" } }));
		runCommand(plugin, "sync-now");
		await vi.waitFor(() => expect(status()).toContain(strings.statusReconnectNeeded), WAIT);

		runCommand(plugin, "reconnect");
		await logIn(dropbox, account);

		await vi.waitFor(() => expect(Notice.shown).toContain(strings.noticeReconnected), WAIT);
		await vi.waitFor(() => expect(status()).toContain(strings.statusSynced), WAIT);
	});
});
