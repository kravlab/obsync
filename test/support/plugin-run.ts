/**
 * What every test running the whole plugin in jsdom uses: the manifest it
 * is loaded with, running its commands, finding its buttons and fields,
 * opening the connect window, pressing Open Dropbox and entering a login
 * code, logging in and connecting as the user does, counting the requests
 * to the fake service until none is under way, and loading the plugin's
 * modules before the first test of a file.
 */
import { beforeAll, expect, vi } from "vitest";
import { selectStrings } from "../../src/ui/i18n/strings";
import type { FakeDropbox, FakeDropboxAccount } from "../fakes/fake-dropbox";
import type { Plugin as FakePlugin, MarkdownView } from "../fakes/obsidian";
import { PLUGIN_LOAD_TIMEOUT_MS } from "./timeouts";

/** The plugin's texts as the tests' Obsidian, set to English, shows them. */
const strings = selectStrings("en");

/**
 * How long a test waits for the plugin to get somewhere: a whole sync over
 * the fake service included. It stays below the budget of a device test
 * (`DEVICE_TEST_TIMEOUT_MS`), so a wait there reports its reason before the
 * test is cut off.
 */
export const PLUGIN_WAIT = { timeout: 5_000 } as const;

/** The manifest Obsidian gives the plugin in `app`'s vault: its id, version and folder. */
export function pluginManifest(app: { vault: { configDir: string } }): { id: string; version: string; dir: string } {
	return { id: "seamsync", version: "0.1.0", dir: `${app.vault.configDir}/plugins/seamsync` };
}

/**
 * Runs the command `id` of `plugin`; an editor command runs on the editor
 * of `view`, the note open in front. Fails when there is no such command,
 * or when it is not offered now: an editor command without `view`, as
 * Obsidian offers one only while a note is open in an editor.
 */
export function runCommand(plugin: FakePlugin, id: string, view?: MarkdownView): void {
	const found = plugin.commands.find((candidate) => candidate.id === id);
	if (found === undefined) throw new Error(`no command ${id}`);
	if (found.editorCallback !== undefined) {
		if (view === undefined) throw new Error(`command ${id} is not offered without a note open in an editor`);
		found.editorCallback(view.editor, view);
		return;
	}
	if (found.callback !== undefined) {
		found.callback();
		return;
	}
	if (found.checkCallback?.(true) !== true) throw new Error(`command ${id} is not offered`);
	found.checkCallback(false);
}

/** The button under `root` with the text `text`; fails when there is none. */
export function buttonIn(root: ParentNode, text: string): HTMLButtonElement {
	const found = [...root.querySelectorAll("button")].find((candidate) => candidate.textContent === text);
	if (found === undefined) throw new Error(`no button ${text}`);
	return found;
}

/** The settings row under `root` named `name`; fails when there is none. */
function rowIn(root: ParentNode, name: string): Element {
	const found = [...root.querySelectorAll(".setting-item")].find(
		(candidate) => candidate.querySelector(".setting-item-name")?.textContent === name,
	);
	if (found === undefined) throw new Error(`no settings row ${name}`);
	return found;
}

/** The text field of the settings row under `root` named `name`; fails when there is none. */
export function fieldIn(root: ParentNode, name: string): HTMLInputElement {
	const input = rowIn(root, name).querySelector("input");
	if (input === null) throw new Error(`no field in the settings row ${name}`);
	return input;
}

/** The button with the text `text` in the settings row under `root` named `name`; fails when there is none. */
export function rowButton(root: ParentNode, name: string, text: string): HTMLButtonElement {
	return buttonIn(rowIn(root, name), text);
}

/** Types `value` into `input` as the user does, so its `onChange` hears it. */
export function typeInto(input: HTMLInputElement, value: string): void {
	input.value = value;
	input.dispatchEvent(new Event("input"));
}

/** What a test logs a plugin in with: where its windows show, the fake service, and who approves the login. */
export interface LoginRun {
	/** The element the plugin's windows show in. */
	readonly root: HTMLElement;
	/** The fake service whose page approves the login. */
	readonly dropbox: FakeDropbox;
	/** The account that approves it. */
	readonly account: FakeDropboxAccount;
	/** The page the connect window opened last. */
	readonly lastOpened: () => string;
}

/** What a test connects a plugin with: a login, the plugin itself, and the notices it showed. */
export interface ConnectRun extends LoginRun {
	/** The plugin, whose settings tab starts connecting. */
	readonly plugin: FakePlugin;
	/** The messages of every notice the plugin showed, oldest first. */
	readonly notices: () => readonly string[];
}

/** Shows `plugin`'s settings tab under `root` and presses its Connect, which opens the connect window. */
export function openConnectWindow(root: HTMLElement, plugin: FakePlugin): void {
	const tab = plugin.settingTabs[0];
	if (tab === undefined) throw new Error("no settings tab");
	root.appendChild(tab.containerEl);
	buttonIn(root, strings.connect).click();
}

/** Presses Open Dropbox once the connect window under `root` offers it, which opens the authorize page. */
export async function openDropbox(root: ParentNode): Promise<void> {
	await vi.waitFor(() => buttonIn(root, strings.openDropbox), PLUGIN_WAIT);
	buttonIn(root, strings.openDropbox).click();
}

/** Types `code` as the login code in the connect window under `root` and presses Continue. */
export function enterLoginCode(root: ParentNode, code: string): void {
	typeInto(fieldIn(root, strings.loginCode), code);
	buttonIn(root, strings.continue).click();
}

/** Logs in on the open connect window as `run.account` approves it on the fake service's page. */
export async function logIn(run: LoginRun): Promise<void> {
	await openDropbox(run.root);
	enterLoginCode(run.root, run.dropbox.approve(run.lastOpened(), run.account));
}

/** Which Remote a plugin connects to, and as which device. */
export interface ConnectChoice {
	/** An existing folder to use as the Remote; without it, a new folder named after the vault. */
	readonly useFolder?: string;
	/** The device name to give; without it, the one the window suggests. */
	readonly deviceName?: string;
	/** Leave the onboarding a new Connection shows open; without it, it is closed with "Got it", which starts the sync. */
	readonly leaveOnboardingOpen?: boolean;
}

/**
 * Connects through the settings tab and the connect window, as the user
 * does: Connect, Open Dropbox, the code the fake service shows the account,
 * then the device name and the Remote of `choice`. Resolves once the
 * plugin says it is connected and, unless `choice` leaves it open, the
 * onboarding it shows is closed with "Got it".
 */
export async function connectThroughSettings(run: ConnectRun, choice: ConnectChoice = {}): Promise<void> {
	openConnectWindow(run.root, run.plugin);
	await logIn(run);
	await vi.waitFor(() => buttonIn(run.root, strings.create), PLUGIN_WAIT);
	if (choice.deviceName !== undefined) typeInto(fieldIn(run.root, strings.deviceName), choice.deviceName);
	if (choice.useFolder === undefined) buttonIn(run.root, strings.create).click();
	else rowButton(run.root, choice.useFolder, strings.useFolder).click();
	// A failure the window shows is the reason given when connecting does not finish.
	const shownFailure = (): string =>
		[...run.root.querySelectorAll(".seamsync-message, .seamsync-message-detail")].map((line) => line.textContent).join(" ");
	await vi.waitFor(() => expect(run.notices(), shownFailure()).toContain(strings.noticeConnected), PLUGIN_WAIT);
	if (choice.leaveOnboardingOpen === true) return;
	await vi.waitFor(() => buttonIn(run.root, strings.onboardingDone), PLUGIN_WAIT);
	buttonIn(run.root, strings.onboardingDone).click();
}

/** Counts the requests to a fake service under way, so a test can wait until none is. */
export class RequestsUnderWay {
	/** How many requests are under way now. */
	private count = 0;

	/** `send`, counting each request while it is under way. */
	counting<Request, Response>(send: (request: Request) => Promise<Response>): (request: Request) => Promise<Response> {
		return async (request) => {
			this.count += 1;
			try {
				return await send(request);
			} finally {
				this.count -= 1;
			}
		};
	}

	/**
	 * Resolves once no request has been under way for two checks in a row;
	 * fails after `PLUGIN_WAIT`. It tells that the requests are done, not
	 * that a sync is: one may be about to send its first request, or be
	 * between two. A test waits for what a sync does instead.
	 */
	async settle(): Promise<void> {
		const step = 20;
		let quiet = 0;
		for (let waited = 0; quiet < 2; waited += step) {
			if (waited > PLUGIN_WAIT.timeout) throw new Error(`requests still under way after ${PLUGIN_WAIT.timeout} ms`);
			await new Promise((resolve) => window.setTimeout(resolve, step));
			quiet = this.count === 0 ? quiet + 1 : 0;
		}
	}
}

/**
 * Loads the plugin's modules once before the first test of the calling
 * file, so the one-time transform of every source file is not paid by a
 * test; call it at the top of the file.
 */
export function preloadPluginModules(): void {
	beforeAll(async () => {
		await import("../../src/main");
	}, PLUGIN_LOAD_TIMEOUT_MS);
}
