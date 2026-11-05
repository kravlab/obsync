// What the desktop and Android runs share about Obsidian's page: the eval
// helpers the scenarios put at the start of a body, the programs that set
// Obsidian's language, the wait for a page to answer, and the scenarios
// both runs check the same way (check 14's buttons, check 19's help and
// onboarding).
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { helpSections, practices } from "../../../src/ui/help-text";
import { selectStrings, type Strings } from "../../../src/ui/i18n/strings";

/** How long one evaluation on the desktop or the phone may take, unless a scenario gives its own: the scenarios' own waits stay well under it. */
export const CALL_MS = 60_000;
/**
 * How long one call may take while waiting for a page to answer
 * (`untilAnswered`): a call lost in a reload is given up and asked again.
 * A call that answers took well under a second.
 */
export const POLL_CALL_MS = 5_000;
/** Headroom of a test over the evaluations and device calls in it, so the page's own timeout message is the one shown. */
export const TEST_HEADROOM_MS = 120_000;

/** An Obsidian a run drives: the desktop's through its CLI, the emulator's through DevTools. */
export interface ObsidianPage {
	/** The value `body`, the body of an async function (see `evalProgram`), returns in Obsidian's page. */
	eval(body: string): Promise<unknown>;
	/** The plugin's strings in Obsidian's language. */
	strings(): Promise<Strings>;
}

/** An Obsidian a run drives whose language a scenario can set. */
export interface LanguagePage extends ObsidianPage {
	/** The id of the plugin under test, which the page loads. */
	readonly pluginId: string;
	/**
	 * Sets Obsidian's language (`en`, `ru`, …), or with `null` removes the
	 * stored language so Obsidian shows its default, and resolves once the page
	 * has reloaded with the plugin loaded (and, for a language, in it).
	 */
	setLanguage(language: string | null): Promise<void>;
}

/**
 * The eval body that sets Obsidian's language, or with `null` removes it:
 * stored where its `getLanguage()` reads it, `localStorage.language`, which
 * it reads only when the page loads, so the page then reloads, after the
 * eval has answered. The page about to reload carries a flag the reloaded
 * one has not, so `reloadedInLanguageProgram` never takes the old page for
 * the new one, even when the old page is already in that language: an eval
 * right after this one still reaches the old page.
 */
export function reloadInLanguageProgram(language: string | null): string {
	const store =
		language === null ? `localStorage.removeItem("language");` : `localStorage.setItem("language", ${JSON.stringify(language)});`;
	return `
		window.seamsyncReloading = true;
		${store}
		setTimeout(() => location.reload(), 100);`;
}

/**
 * The eval body answering whether the page has reloaded in `language`
 * (see `reloadInLanguageProgram`) with the plugin `pluginId` loaded; false,
 * not a failure, while the reloaded page is still loading. moment's locale
 * stands in for `getLanguage()`, as in `strings()`. With `null`, the
 * language removed, the locale is not checked: it is the default's, which
 * the program cannot name.
 */
export function reloadedInLanguageProgram(language: string | null, pluginId: string): string {
	const conditions = [
		"window.seamsyncReloading !== true",
		"window.app?.workspace?.layoutReady === true",
		`app.plugins.plugins[${JSON.stringify(pluginId)}] !== undefined`,
		...(language === null ? [] : [`window.moment?.locale() === ${JSON.stringify(language)}`]),
	];
	return `
		return ${conditions.join("\n\t\t\t&& ")};`;
}

/**
 * Resolves once `ask` answers true, asking again every `everyMs` after any
 * other answer or a failure, such as a call lost in a page reload.
 * `mustGoOn`, called before each ask, ends the wait at once by throwing
 * (e.g. Obsidian has exited). Fails after `timeoutMs` with `what` and the
 * last failure.
 */
export async function untilAnswered(
	ask: () => Promise<unknown>,
	options: { readonly timeoutMs: number; readonly what: string; readonly mustGoOn?: () => void; readonly everyMs?: number },
): Promise<void> {
	const { timeoutMs, what, mustGoOn = () => undefined, everyMs = 250 } = options;
	const end = Date.now() + timeoutMs;
	let last: unknown = "not asked";
	while (Date.now() < end) {
		mustGoOn();
		try {
			if ((await ask()) === true) return;
			last = "not ready yet";
		} catch (error) {
			last = error;
		}
		await new Promise((resolve) => setTimeout(resolve, everyMs));
	}
	throw new Error(`${what} within ${timeoutMs} ms: ${String(last)}`);
}

/**
 * Eval helpers for the scenarios, to put at the start of a body:
 *
 * - `button(text, root = activeDocument)` waits for a button with that text
 *   in an open window (or in `root`);
 * - `syncWindow()` waits for the open Sync window and resolves with it;
 * - `openSyncWindow(command = "seamsync:open-sync-window")` runs that command
 *   (the plugin's Open sync window, unless given another that opens the
 *   window, such as Show help) and resolves with the window;
 * - `selectedTab(sync)` is the text of the Sync window's selected tab;
 * - `helpElements(sync)` lists the Sync window body's headings, paragraphs,
 *   lists and list items in document order as `{ tag, text }`, with an
 *   empty text for a list (`ul`), which marks where it starts;
 * - `onboardingWindow(doneText)` waits for the open onboarding, the window
 *   other than the Sync window with a button whose text is `doneText`, and
 *   resolves with it;
 * - `readOnboarding(modal)` reads the onboarding's title, intro and list
 *   items as `{ title, intro, items }`;
 * - `buttons(root)` lists a root's buttons with their heights, in layout
 *   pixels (`offsetHeight`): the box's own height is snapped to device
 *   pixels, so 44 px can read 43.99 at a fractional device pixel ratio;
 * - `closeModals()` closes every open window with Escape, as a user does,
 *   one window per key press;
 * - `withSettings(use)` opens Obsidian's settings at the plugin's tab,
 *   resolves with what `use(tab)`, given the tab's contents, resolves
 *   with, and closes the settings however it ends, so a window left open
 *   takes no later typing;
 * - `settingRow(name, root = activeDocument)` waits for the settings row
 *   whose name is `name`, exactly;
 * - `typeInto(input, value)` sets the input's value and dispatches an `input`
 *   event on it (one that does not bubble), as typing does for the settings
 *   fields;
 * - `modalTitled(title)` is the open window whose title is `title`, exactly,
 *   or undefined when there is none;
 * - `noticeAmong(outcomes)` is the text of the first notice, in document
 *   order, whose text is one of `outcomes`, or undefined when there is none;
 * - `dropdowns(root)` lists the real dropdowns under `root`, in document
 *   order. Mobile Obsidian adds, next to each dropdown, a hidden measuring
 *   select (`is-measuring`) with one option holding the selected option's
 *   text, so a bare `select` or `option` query can hit it;
 * - `dropdown(root)` is the first real dropdown under `root`. Throws when
 *   `root` holds none.
 */
export const PAGE_HELPERS = `
	const button = (text, root) => until(
		() => [...(root ?? activeDocument).querySelectorAll(root ? "button" : ".modal button")].find((b) => b.textContent === text),
		10000,
		"the " + text + " button",
	);
	const syncWindow = () => until(() => activeDocument.querySelector(".modal.seamsync-sync-window"), 10000, "the Sync window");
	const openSyncWindow = (command = "seamsync:open-sync-window") => {
		app.commands.executeCommandById(command);
		return syncWindow();
	};
	const selectedTab = (sync) => sync.querySelector(".seamsync-sync-tab-selected")?.textContent;
	const helpElements = (sync) => [...sync.querySelector(".seamsync-sync-body").querySelectorAll("h4, p, ul, li")].map((element) => {
		const tag = element.tagName.toLowerCase();
		return { tag, text: tag === "ul" ? "" : element.textContent };
	});
	const onboardingWindow = (doneText) => until(
		() => [...activeDocument.querySelectorAll(".modal")].find((m) => !m.classList.contains("seamsync-sync-window") && [...m.querySelectorAll("button")].some((b) => b.textContent === doneText)),
		10000,
		"the onboarding",
	);
	const readOnboarding = (modal) => ({
		title: modal.querySelector(".modal-title")?.textContent,
		intro: modal.querySelector("p")?.textContent,
		items: [...modal.querySelectorAll("li")].map((li) => li.textContent),
	});
	const buttons = (root) => [...root.querySelectorAll("button")].map((b) => ({ text: b.textContent, height: b.offsetHeight }));
	const closeModals = () => until(() => {
		if (activeDocument.querySelectorAll(".modal").length === 0) return true;
		activeDocument.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));
		return false;
	}, 10000, "the windows to close");
	const withSettings = async (use) => {
		app.setting.open();
		try {
			app.setting.openTabById("seamsync");
			return await use(await until(() => app.setting.activeTab?.id === "seamsync" && app.setting.activeTab.containerEl, 10000, "the plugin's settings tab"));
		} finally {
			app.setting.close();
		}
	};
	const settingRow = (name, root) => until(
		() => [...(root ?? activeDocument).querySelectorAll(".setting-item")].find((row) => row.querySelector(".setting-item-name")?.textContent === name),
		10000,
		"the " + name + " row",
	);
	const typeInto = (input, value) => {
		input.value = value;
		input.dispatchEvent(new Event("input"));
	};
	const modalTitled = (title) => [...activeDocument.querySelectorAll(".modal")].find((m) => m.querySelector(".modal-title")?.textContent === title);
	const noticeAmong = (outcomes) => [...activeDocument.querySelectorAll(".notice")].map((n) => n.textContent).find((text) => outcomes.includes(text));
	const dropdowns = (root) => [...root.querySelectorAll("select.dropdown:not(.is-measuring)")];
	const dropdown = (root) => {
		const found = dropdowns(root)[0];
		if (!found) throw new Error("the dropdown is missing under the given root");
		return found;
	};`;

/** An element of the Sync window's body, as `helpElements` lists it: the tag in lower case, and the text, empty for a list. */
export interface HelpElement {
	readonly tag: string;
	readonly text: string;
}

/**
 * The Help tab's elements in the order `helpSections(strings)` gives them,
 * as `helpElements` lists them: per section its heading, its paragraphs,
 * then, when it has a list, the list's marker and its items.
 */
export function expectedHelpElements(strings: Strings): HelpElement[] {
	return helpSections(strings).flatMap((section) => [
		{ tag: "h4", text: section.heading },
		...section.paragraphs.map((text) => ({ tag: "p", text })),
		...(section.list.length === 0 ? [] : [{ tag: "ul", text: "" }, ...section.list.map((text) => ({ tag: "li", text }))]),
	]);
}

/** The onboarding as `readOnboarding` reads it: its title, its intro and its list items. */
export interface OnboardingFound {
	readonly title: string;
	readonly intro: string;
	readonly items: string[];
}

/** The onboarding as `readOnboarding` reads it when it shows `strings`: the title, the intro and the practices in order. */
export function expectedOnboarding(strings: Strings): OnboardingFound {
	return { title: strings.onboardingTitle, intro: strings.onboardingIntro, items: practices(strings) };
}

/** A window's or row's buttons, as `buttons(root)` lists them, and whether it carries `seamsync-phone`. */
export interface ButtonsFound {
	readonly phone: boolean;
	readonly buttons: readonly { readonly text: string; readonly height: number }[];
}

/** The minimum height of a button on a phone (spec, check 14). */
const MIN_BUTTON_PX = 44;

/** Expects `found` to be a phone window with buttons, none below MIN_BUTTON_PX. */
export function expectPhoneButtons(found: ButtonsFound): void {
	expect(found.phone).toBe(true);
	expect(found.buttons.length).toBeGreaterThan(0);
	expect(found.buttons.filter((button) => button.height < MIN_BUTTON_PX)).toEqual([]);
}

/**
 * Check 14 for what opens without a Dropbox login: the Sync window, the
 * connect window, a conflict block's action row and its Edit… dialog, and
 * the Help tab with the onboarding it opens, on `page`, which is a phone.
 * `title` names the check for the run's summary. Each program closes every
 * window in a `finally`, so a failing test leaves no window open to the next.
 */
export function describePhoneButtons(title: string, page: () => ObsidianPage): void {
	describe(title, () => {
		it("in the Sync window and the connect window", async () => {
			const strings = await page().strings();
			const found = (await page().eval(`
				${PAGE_HELPERS}
				try {
					const sync = await openSyncWindow();
					const syncButtons = buttons(sync);
					(await button(${JSON.stringify(strings.connect)}, sync)).click();
					const connect = await until(() => [...activeDocument.querySelectorAll(".modal")].find((m) => m !== sync && m.querySelector("input")), 10000, "the connect window");
					const result = { sync: { phone: sync.classList.contains("seamsync-phone"), buttons: syncButtons }, connect: { phone: connect.classList.contains("seamsync-phone"), buttons: buttons(connect) } };
					return result;
				} finally {
					await closeModals();
				}`)) as Record<"sync" | "connect", ButtonsFound>;
			expectPhoneButtons(found.sync);
			expectPhoneButtons(found.connect);
		});

		it("in a conflict block's action row and its Edit… dialog", async () => {
			const strings = await page().strings();
			const note = ["<<<<<<< Phone vault", "mine", "=======", "theirs", ">>>>>>> Remote", ""].join("\n");
			const found = (await page().eval(`
				${PAGE_HELPERS}
				try {
					const file = await app.vault.create("phone-conflict.md", ${JSON.stringify(note)});
					const leaf = app.workspace.getLeaf(true);
					await leaf.setViewState({ type: "markdown", state: { file: file.path, mode: "source", source: false } });
					const row = await until(() => leaf.view.contentEl.querySelector(".seamsync-conflict-actions"), 10000, "the action row");
					const rowButtons = buttons(row);
					(await button(${JSON.stringify(strings.conflictEdit)}, row)).click();
					const dialog = await until(() => activeDocument.querySelector(".modal.seamsync-conflict-edit"), 10000, "the Edit dialog");
					const result = { row: { phone: row.classList.contains("seamsync-phone"), buttons: rowButtons }, dialog: { phone: dialog.classList.contains("seamsync-phone"), buttons: buttons(dialog) } };
					leaf.detach();
					await app.vault.delete(file);
					return result;
				} finally {
					await closeModals();
				}`)) as Record<"row" | "dialog", ButtonsFound>;
			expectPhoneButtons(found.row);
			expectPhoneButtons(found.dialog);
		});

		it("in the Help tab and the onboarding", async () => {
			const strings = await page().strings();
			const found = (await page().eval(`
				${PAGE_HELPERS}
				try {
					const sync = await openSyncWindow("seamsync:show-help");
					const syncFound = { phone: sync.classList.contains("seamsync-phone"), buttons: buttons(sync) };
					(await button(${JSON.stringify(strings.showOnboarding)}, sync)).click();
					const onboarding = await onboardingWindow(${JSON.stringify(strings.onboardingDone)});
					const onboardingFound = { phone: onboarding.classList.contains("seamsync-phone"), buttons: buttons(onboarding) };
					(await button(${JSON.stringify(strings.onboardingDone)}, onboarding)).click();
					return { sync: syncFound, onboarding: onboardingFound };
				} finally {
					await closeModals();
				}`)) as Record<"sync" | "onboarding", ButtonsFound>;
			expectPhoneButtons(found.sync);
			expectPhoneButtons(found.onboarding);
		});
	});
}

/**
 * Check 19 on `page`: the help and the onboarding show the strings of the
 * language Obsidian is set to, English then Russian. Every test compares the
 * plugin's strings of that language, so the whole scenario fails if the
 * language shown is not the one set; the first test checks it through the
 * name of the plugin's command. The "Show help" command opens the Sync
 * window at the Help tab, which lists every section of the help in order;
 * `options.settingsRow` turns on one more test, which opens the Help tab from
 * the settings row "Open help" and expects the same; "Show the four habits
 * again" opens the onboarding with its title, intro and four practices, and
 * "Got it" closes it. `title` names the check for the run's summary. A
 * failing test leaves no window open to the next. The language Obsidian was
 * in before the scenario, or none, is restored once the scenario ends, so
 * the scenarios after it run in it.
 */
export function describeOnboardingHelp(title: string, page: () => LanguagePage, options: { readonly settingsRow: boolean }): void {
	describe(title, () => {
		// Undefined until read, so a failed read restores nothing; null when Obsidian had no language stored.
		let languageBefore: string | null | undefined;

		beforeAll(async () => {
			languageBefore = (await page().eval(`return localStorage.getItem("language");`)) as string | null;
		});

		afterEach(async () => {
			await page().eval(`${PAGE_HELPERS} await closeModals();`);
		});

		// The id of the Show help command: the plugin's id, known once the page is open.
		const showHelpCommand = () => `${page().pluginId}:show-help`;

		afterAll(async () => {
			if (languageBefore === undefined) return;
			await page().setLanguage(languageBefore);
		});

		for (const language of ["en", "ru"]) {
			describe(`Obsidian set to ${language}`, () => {
				const strings = selectStrings(language);

				beforeAll(async () => {
					await page().setLanguage(language);
				});

				it("shows the plugin in the language set", async () => {
					// Obsidian names a plugin's command "<manifest name>: <command name>".
					const shown = (await page().eval(`
						return {
							command: app.commands.commands[${JSON.stringify(showHelpCommand())}]?.name,
							plugin: app.plugins.manifests[${JSON.stringify(page().pluginId)}].name,
						};`)) as { command: string | undefined; plugin: string };
					expect(shown.command).toBe(`${shown.plugin}: ${strings.showHelp}`);
					// A language with no table of its own would show English: it must not pass.
					if (language !== "en") expect(strings.showHelp).not.toBe(selectStrings("en").showHelp);
				});

				it("opens the Help tab from the Show help command, with every section and the button", async () => {
					const shown = (await page().eval(`
						${PAGE_HELPERS}
						const sync = await openSyncWindow(${JSON.stringify(showHelpCommand())});
						return {
							tab: selectedTab(sync),
							hasButton: [...sync.querySelector(".seamsync-sync-body").querySelectorAll("button")].some((b) => b.textContent === ${JSON.stringify(strings.showOnboarding)}),
							elements: helpElements(sync),
						};`)) as { tab: string; hasButton: boolean; elements: HelpElement[] };
					expect(shown.tab).toBe(strings.tabHelp);
					expect(shown.hasButton).toBe(true);
					expect(shown.elements).toEqual(expectedHelpElements(strings));
				});

				it.runIf(options.settingsRow)("opens the Help tab from the settings row", async () => {
					const shown = (await page().eval(`
						${PAGE_HELPERS}
						// The Sync window opens over the settings, and Obsidian closes it with them: it is read before they close.
						return await withSettings(async (tab) => {
							(await settingRow(${JSON.stringify(strings.openHelp)}, tab)).click();
							const sync = await syncWindow();
							return { tab: selectedTab(sync), elements: helpElements(sync) };
						});`)) as { tab: string; elements: HelpElement[] };
					expect(shown.tab).toBe(strings.tabHelp);
					expect(shown.elements).toEqual(expectedHelpElements(strings));
				});

				it("opens the onboarding from Show the four habits again, and Got it closes it", async () => {
					const shown = (await page().eval(`
						${PAGE_HELPERS}
						const sync = await openSyncWindow(${JSON.stringify(showHelpCommand())});
						(await button(${JSON.stringify(strings.showOnboarding)}, sync)).click();
						const modal = await onboardingWindow(${JSON.stringify(strings.onboardingDone)});
						const result = readOnboarding(modal);
						(await button(${JSON.stringify(strings.onboardingDone)}, modal)).click();
						await until(() => !modal.isConnected, 10000, "the onboarding to close");
						return result;`)) as OnboardingFound;
					expect(shown).toEqual(expectedOnboarding(strings));
				});
			});
		}
	});
}
