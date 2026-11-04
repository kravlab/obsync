// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { helpSections, practices } from "../../../src/ui/help-text";
import { selectStrings } from "../../../src/ui/i18n/strings";
import { expectedHelpElements, expectedOnboarding, PAGE_HELPERS, reloadedInLanguageProgram, reloadInLanguageProgram, untilAnswered } from "./page";
import { runInPage } from "./page-runner";

afterEach(() => {
	document.body.replaceChildren();
});

/** A page's localStorage, over a map. */
function storage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> {
	const items = new Map<string, string>();
	return { getItem: (key) => items.get(key) ?? null, setItem: (key, value) => void items.set(key, value), removeItem: (key) => void items.delete(key) };
}

/** A page's globals once Obsidian has loaded in `locale`, with the plugin `seamsync` loaded or not. */
function loadedPage(locale: string, pluginLoaded = true): Record<string, unknown> {
	return {
		localStorage: storage(),
		location: { reload: vi.fn() },
		moment: { locale: () => locale },
		app: { workspace: { layoutReady: true }, plugins: { plugins: pluginLoaded ? { seamsync: {} } : {} } },
	};
}

/** Whether `page` counts as reloaded in Russian with the plugin `seamsync` loaded. */
function reloadedInRussian(page: Record<string, unknown>): Promise<unknown> {
	return runInPage(reloadedInLanguageProgram("ru", "seamsync"), page);
}

describe("reloadInLanguageProgram", () => {
	it("stores the language where Obsidian reads it, then reloads the page once the eval has answered", async () => {
		const page = loadedPage("en");
		const { reload } = page.location as { reload: () => void };
		await runInPage(reloadInLanguageProgram("ru"), page);
		expect(reload).not.toHaveBeenCalled();
		expect((page.localStorage as Storage).getItem("language")).toBe("ru");
		await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce());
	});

	it("with no language, removes the stored one, then reloads the page once the eval has answered", async () => {
		const page = loadedPage("ru");
		const { reload } = page.location as { reload: () => void };
		(page.localStorage as Storage).setItem("language", "ru");
		await runInPage(reloadInLanguageProgram(null), page);
		expect(reload).not.toHaveBeenCalled();
		expect((page.localStorage as Storage).getItem("language")).toBeNull();
		await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce());
	});

	it("with no language, flags the page about to reload, and does not fail when none was stored", async () => {
		const page = loadedPage("en");
		await runInPage(reloadInLanguageProgram(null), page);
		expect((page.localStorage as Storage).getItem("language")).toBeNull();
		expect(await runInPage(reloadedInLanguageProgram(null, "seamsync"), page)).toBe(false);
	});
});

describe("reloadedInLanguageProgram", () => {
	it("answers no on the page still to reload, even in the language asked for", async () => {
		const page = loadedPage("ru");
		await runInPage(reloadInLanguageProgram("ru"), page);
		expect(await reloadedInRussian(page)).toBe(false);
	});

	it("answers yes once a page in that language has loaded the plugin", async () => {
		expect(await reloadedInRussian(loadedPage("ru"))).toBe(true);
	});

	it("answers no on a page in another language, or without the plugin", async () => {
		expect(await reloadedInRussian(loadedPage("en"))).toBe(false);
		expect(await reloadedInRussian(loadedPage("ru", false))).toBe(false);
	});

	it("answers yes with no language, whatever the locale, once the plugin has loaded", async () => {
		expect(await runInPage(reloadedInLanguageProgram(null, "seamsync"), loadedPage("ru"))).toBe(true);
		expect(await runInPage(reloadedInLanguageProgram(null, "seamsync"), loadedPage("en"))).toBe(true);
	});

	it("answers no with no language on the page still to reload, without the plugin, or while loading", async () => {
		const reloading = loadedPage("en");
		await runInPage(reloadInLanguageProgram("ru"), reloading);
		expect(await runInPage(reloadedInLanguageProgram(null, "seamsync"), reloading)).toBe(false);
		expect(await runInPage(reloadedInLanguageProgram(null, "seamsync"), loadedPage("en", false))).toBe(false);
		const noApp = loadedPage("en");
		delete noApp.app;
		expect(await runInPage(reloadedInLanguageProgram(null, "seamsync"), noApp)).toBe(false);
	});

	it("looks for the plugin it is given", async () => {
		expect(await runInPage(reloadedInLanguageProgram("ru", "other"), loadedPage("ru"))).toBe(false);
	});

	it("answers no, not a failure, while the reloaded page is still loading", async () => {
		const noApp = loadedPage("ru");
		delete noApp.app;
		expect(await reloadedInRussian(noApp)).toBe(false);
		const noLayout = loadedPage("ru");
		(noLayout.app as { workspace: { layoutReady: boolean } }).workspace.layoutReady = false;
		expect(await reloadedInRussian(noLayout)).toBe(false);
		const noMoment = loadedPage("ru");
		delete noMoment.moment;
		expect(await reloadedInRussian(noMoment)).toBe(false);
	});
});

describe("untilAnswered", () => {
	it("asks again after a failure and another answer, until the answer is true", async () => {
		const answers = [() => Promise.reject(new Error("lost in the reload")), () => Promise.resolve(false), () => Promise.resolve(true)];
		const ask = vi.fn(() => answers[ask.mock.calls.length - 1]());
		await untilAnswered(ask, { timeoutMs: 10_000, what: "Obsidian did not answer", everyMs: 0 });
		expect(ask).toHaveBeenCalledTimes(3);
	});

	it("fails after its time with what it waited for and the last failure", async () => {
		const ask = () => Promise.reject(new Error("lost in the reload"));
		await expect(untilAnswered(ask, { timeoutMs: 20, what: "Obsidian did not reload in ru", everyMs: 1 })).rejects.toThrow(
			/^Obsidian did not reload in ru within 20 ms: Error: lost in the reload$/,
		);
	});

	it("ends at once, without asking, when it must not go on", async () => {
		const ask = vi.fn(() => Promise.resolve(true));
		const mustGoOn = () => {
			throw new Error("Obsidian exited");
		};
		await expect(untilAnswered(ask, { timeoutMs: 10_000, what: "Obsidian did not answer", mustGoOn })).rejects.toThrow("Obsidian exited");
		expect(ask).not.toHaveBeenCalled();
	});
});

/** Obsidian's settings, whose `openTabById` makes `shownTab` the active tab with `contents`; each call is logged in `events`. */
function settingsWith(contents: HTMLElement, shownTab = (id: string) => id) {
	const events: string[] = [];
	const setting = {
		activeTab: undefined as unknown,
		open: () => events.push("opened"),
		openTabById: (id: string) => {
			events.push(`tab ${id}`);
			setting.activeTab = { id: shownTab(id), containerEl: contents };
		},
		close: () => events.push("closed"),
	};
	return { globals: { app: { setting } }, events };
}

describe("withSettings()", () => {
	it("gives the plugin's tab to what it runs, answers with its value, then closes the settings", async () => {
		const { globals, events } = settingsWith(createDiv({ text: "the plugin's settings" }));
		const shown = await runInPage(`${PAGE_HELPERS} return await withSettings(async (tab) => tab.textContent);`, globals);
		expect(shown).toBe("the plugin's settings");
		expect(events).toEqual(["opened", "tab seamsync", "closed"]);
	});

	it("closes the settings when what it runs fails", async () => {
		const { globals, events } = settingsWith(createDiv());
		await expect(runInPage(`${PAGE_HELPERS} await withSettings(async () => { throw new Error("boom"); });`, globals)).rejects.toThrow("boom");
		expect(events.at(-1)).toBe("closed");
	});

	it("fails, closing the settings, when another tab stays shown", async () => {
		const { globals, events } = settingsWith(createDiv(), () => "editor");
		await expect(runInPage(`${PAGE_HELPERS} await withSettings(async () => "never");`, globals)).rejects.toThrow(/the plugin's settings tab/);
		expect(events.at(-1)).toBe("closed");
	});
});

/** A settings row named `name`, marked `mark`, in `root`. */
function addRow(root: HTMLElement, name: string, mark: string): void {
	root.createDiv({ cls: "setting-item", attr: { "data-mark": mark } }).createDiv({ cls: "setting-item-name", text: name });
}

describe("settingRow()", () => {
	it("finds the row of that name, not one whose name only holds it", async () => {
		addRow(document.body, "Device name of this one", "longer");
		addRow(document.body, "Device name", "exact");
		expect(await runInPage(`${PAGE_HELPERS} return (await settingRow("Device name")).dataset.mark;`, {})).toBe("exact");
	});

	it("looks only in the root it is given", async () => {
		addRow(document.body, "Device name", "outside");
		const root = document.body.createDiv();
		addRow(root, "Device name", "inside");
		const found = await runInPage(`${PAGE_HELPERS} return (await settingRow("Device name", activeDocument.body.lastElementChild)).dataset.mark;`, {});
		expect(found).toBe("inside");
	});

	it("fails naming the row it waited for", async () => {
		addRow(document.body, "Device name", "outside");
		document.body.createDiv();
		await expect(runInPage(`${PAGE_HELPERS} await settingRow("Device name", activeDocument.body.lastElementChild);`, {})).rejects.toThrow(
			/the Device name row/,
		);
	});
});

/** Appends a select of that class with options of those values (the text is the value, or "shown" when none). */
function addSelect(root: HTMLElement, cls: string, values: readonly (string | null)[]): void {
	const select = root.createEl("select", { cls });
	for (const value of values) {
		const option = select.createEl("option", { text: value ?? "shown" });
		if (value !== null) option.value = value;
	}
}

describe("typeInto()", () => {
	it("sets the value and dispatches one input event on the input, the value already set", async () => {
		const input = document.body.createEl("input");
		const seen: string[] = [];
		input.addEventListener("input", () => seen.push(input.value));
		await runInPage(`${PAGE_HELPERS} typeInto(activeDocument.querySelector("input"), "50");`, {});
		expect(input.value).toBe("50");
		expect(seen).toEqual(["50"]);
	});
});

describe("modalTitled()", () => {
	it("finds the open window of that title, not another window or one whose title only holds it", async () => {
		addModal("Forget Phone");
		addModal("Forget", ["Cancel"]).dataset.mark = "exact";
		addModal("Another window");
		expect(await runInPage(`${PAGE_HELPERS} return modalTitled("Forget").dataset.mark;`, {})).toBe("exact");
	});

	it("is nothing when no open window has that title", async () => {
		addModal("Another window");
		document.body.createDiv({ cls: "modal" });
		expect(await runInPage(`${PAGE_HELPERS} return modalTitled("Forget") ?? null;`, {})).toBeNull();
	});
});

describe("noticeAmong()", () => {
	it("is the text of the notice that is one of the outcomes, among other notices", async () => {
		document.body.createDiv({ cls: "notice", text: "Syncing" });
		document.body.createDiv({ cls: "notice", text: "Disconnected" });
		expect(await runInPage(`${PAGE_HELPERS} return noticeAmong(["Disconnect failed", "Disconnected"]);`, {})).toBe("Disconnected");
	});

	it("is the first of the notices that match, in document order, whatever the order of the outcomes", async () => {
		document.body.createDiv({ cls: "notice", text: "Disconnect failed" });
		document.body.createDiv({ cls: "notice", text: "Disconnected" });
		expect(await runInPage(`${PAGE_HELPERS} return noticeAmong(["Disconnected", "Disconnect failed"]);`, {})).toBe("Disconnect failed");
	});

	it("is nothing when no notice is one of the outcomes, or none is shown", async () => {
		expect(await runInPage(`${PAGE_HELPERS} return noticeAmong(["Disconnected"]) ?? null;`, {})).toBeNull();
		document.body.createDiv({ cls: "notice", text: "Disconnected from Dropbox" });
		document.body.createDiv({ cls: "modal", text: "Disconnected" });
		expect(await runInPage(`${PAGE_HELPERS} return noticeAmong(["Disconnected"]) ?? null;`, {})).toBeNull();
	});
});

describe("dropdowns()", () => {
	it("lists the real selects in document order, leaving out the measuring ones", async () => {
		const row = document.body.createDiv();
		addSelect(row, "dropdown", ["first"]);
		addSelect(row, "dropdown is-measuring", [null]);
		addSelect(row, "dropdown", ["second"]);
		const found = await runInPage(`${PAGE_HELPERS} return dropdowns(activeDocument.body.lastElementChild).map((s) => s.options[0].value);`, {});
		expect(found).toEqual(["first", "second"]);
	});

	it("lists nothing when there is no real one", async () => {
		const row = document.body.createDiv();
		addSelect(row, "dropdown is-measuring", [null]);
		expect(await runInPage(`${PAGE_HELPERS} return dropdowns(activeDocument.body.lastElementChild).length;`, {})).toBe(0);
		document.body.createDiv();
		expect(await runInPage(`${PAGE_HELPERS} return dropdowns(activeDocument.body.lastElementChild).length;`, {})).toBe(0);
	});
});

describe("dropdown()", () => {
	it("returns the real select, not the hidden measuring one after it", async () => {
		const row = document.body.createDiv();
		addSelect(row, "dropdown", ["mine", "remote"]);
		addSelect(row, "dropdown is-measuring", [null]);
		const found = await runInPage(`${PAGE_HELPERS} const s = dropdown(activeDocument.body.lastElementChild); return [s.classList.contains("is-measuring"), [...s.options].map((o) => o.value)];`, {});
		expect(found).toEqual([false, ["mine", "remote"]]);
	});

	it("returns the real select when the measuring one comes first", async () => {
		const row = document.body.createDiv();
		addSelect(row, "dropdown is-measuring", [null]);
		addSelect(row, "dropdown", ["mine", "remote"]);
		const found = await runInPage(`${PAGE_HELPERS} const s = dropdown(activeDocument.body.lastElementChild); return [s.classList.contains("is-measuring"), [...s.options].map((o) => o.value)];`, {});
		expect(found).toEqual([false, ["mine", "remote"]]);
	});

	it("fails naming the dropdown when there is no real one", async () => {
		const row = document.body.createDiv();
		addSelect(row, "dropdown is-measuring", [null]);
		await expect(runInPage(`${PAGE_HELPERS} dropdown(activeDocument.body.lastElementChild);`, {})).rejects.toThrow(/the dropdown is missing/);
	});
});

/** A Sync window with a tab bar, `selected` the text of the tab marked selected, and an empty body. */
function addSyncWindow(selected: string): HTMLElement {
	const sync = document.body.createDiv({ cls: "modal seamsync-sync-window" });
	const tabs = sync.createDiv({ cls: "seamsync-sync-tabs" });
	for (const tab of ["Conflicts", "Activity", "Help"]) tabs.createEl("button", { cls: tab === selected ? "seamsync-sync-tab seamsync-sync-tab-selected" : "seamsync-sync-tab", text: tab });
	sync.createDiv({ cls: "seamsync-sync-body" });
	return sync;
}

/** A window other than the Sync window, with a title, an intro, list items and a button for each of `buttons`. */
function addModal(title: string, buttons: string[] = []): HTMLElement {
	const modal = document.body.createDiv({ cls: "modal" });
	modal.createDiv({ cls: "modal-title", text: title });
	modal.createEl("p", { text: `${title} intro` });
	modal.createEl("ul").createEl("li", { text: `${title} item` });
	for (const text of buttons) modal.createEl("button", { text });
	return modal;
}

/** Obsidian's commands, whose `executeCommandById` logs the id in `ran` and then opens a Sync window. */
function commandsOpeningSyncWindow() {
	const ran: string[] = [];
	const executeCommandById = (id: string) => {
		ran.push(id);
		addSyncWindow("Help");
	};
	return { globals: { app: { commands: { executeCommandById } } }, ran };
}

describe("syncWindow()", () => {
	it("resolves with the open Sync window, not another window", async () => {
		addModal("Another window");
		const sync = addSyncWindow("Help");
		sync.dataset.mark = "sync";
		expect(await runInPage(`${PAGE_HELPERS} return (await syncWindow()).dataset.mark;`, {})).toBe("sync");
	});

	it("fails naming the Sync window when none opens", async () => {
		addModal("Another window");
		await expect(runInPage(`${PAGE_HELPERS} await syncWindow();`, {})).rejects.toThrow(/the Sync window/);
	});
});

describe("openSyncWindow()", () => {
	it("runs the Open sync window command when given none, and resolves with the window", async () => {
		const { globals, ran } = commandsOpeningSyncWindow();
		const opened = await runInPage(`${PAGE_HELPERS} return (await openSyncWindow()).classList.contains("seamsync-sync-window");`, globals);
		expect(opened).toBe(true);
		expect(ran).toEqual(["seamsync:open-sync-window"]);
	});

	it("runs the command it is given instead, and resolves with the window", async () => {
		const { globals, ran } = commandsOpeningSyncWindow();
		const opened = await runInPage(`${PAGE_HELPERS} return (await openSyncWindow("seamsync:show-help")).classList.contains("seamsync-sync-window");`, globals);
		expect(opened).toBe(true);
		expect(ran).toEqual(["seamsync:show-help"]);
	});
});

describe("selectedTab()", () => {
	it("is the text of the selected tab", async () => {
		addSyncWindow("Activity");
		expect(await runInPage(`${PAGE_HELPERS} return selectedTab(activeDocument.querySelector(".seamsync-sync-window"));`, {})).toBe("Activity");
	});

	it("is nothing when no tab is selected", async () => {
		addSyncWindow("none");
		expect(await runInPage(`${PAGE_HELPERS} return selectedTab(activeDocument.querySelector(".seamsync-sync-window")) ?? null;`, {})).toBeNull();
	});
});

describe("helpElements()", () => {
	it("lists the body's headings, paragraphs, lists and list items in document order, a list with an empty text", async () => {
		const sync = addSyncWindow("Help");
		sync.createEl("p", { text: "Outside the body" });
		const body = sync.querySelector<HTMLElement>(".seamsync-sync-body")!;
		body.createDiv({ cls: "setting-item" }).createEl("button", { text: "Show again" });
		body.createEl("h4", { text: "First" });
		body.createEl("p", { text: "About first" });
		const list = body.createEl("ul");
		list.createEl("li", { text: "One" });
		list.createEl("li", { text: "Two" });
		body.createEl("h4", { text: "Second" });
		body.createEl("p", { text: "About second" });
		const shown = await runInPage(`${PAGE_HELPERS} return helpElements(activeDocument.querySelector(".seamsync-sync-window"));`, {});
		expect(shown).toEqual([
			{ tag: "h4", text: "First" },
			{ tag: "p", text: "About first" },
			{ tag: "ul", text: "" },
			{ tag: "li", text: "One" },
			{ tag: "li", text: "Two" },
			{ tag: "h4", text: "Second" },
			{ tag: "p", text: "About second" },
		]);
	});
});

describe("onboardingWindow()", () => {
	it("resolves with the window other than the Sync window that holds the button", async () => {
		const sync = addSyncWindow("Help");
		sync.createEl("button", { text: "Got it" });
		addModal("Without the button", ["Cancel"]);
		addModal("Onboarding", ["Got it"]).dataset.mark = "onboarding";
		expect(await runInPage(`${PAGE_HELPERS} return (await onboardingWindow("Got it")).dataset.mark;`, {})).toBe("onboarding");
	});

	it("fails naming the onboarding when only the Sync window or a window without the button is open", async () => {
		addSyncWindow("Help").createEl("button", { text: "Got it" });
		addModal("Without the button", ["Cancel"]);
		await expect(runInPage(`${PAGE_HELPERS} await onboardingWindow("Got it");`, {})).rejects.toThrow(/the onboarding/);
	});
});

describe("readOnboarding()", () => {
	it("reads the title, the first paragraph and the list items", async () => {
		const modal = addModal("Onboarding", ["Got it"]);
		modal.createEl("p", { text: "A second paragraph" });
		modal.querySelector("ul")!.createEl("li", { text: "Onboarding second item" });
		const shown = await runInPage(`${PAGE_HELPERS} return readOnboarding(activeDocument.querySelector(".modal"));`, {});
		expect(shown).toEqual({ title: "Onboarding", intro: "Onboarding intro", items: ["Onboarding item", "Onboarding second item"] });
	});
});

describe("expectedHelpElements()", () => {
	const strings = selectStrings("en");
	const sections = helpSections(strings);

	it("gives a section's heading, then its paragraphs, then, with a list, its marker and items", () => {
		const elements = expectedHelpElements(strings);
		expect(elements.slice(0, 2 + practices(strings).length)).toEqual([
			{ tag: "h4", text: sections[0].heading },
			{ tag: "ul", text: "" },
			...practices(strings).map((text) => ({ tag: "li", text })),
		]);
	});

	it("has no marker for a section without a list", () => {
		const elements = expectedHelpElements(strings);
		const conflicts = elements.findIndex((element) => element.text === sections[1].heading);
		expect(elements.slice(conflicts, conflicts + 4).map((element) => element.tag)).toEqual(["h4", "p", "p", "h4"]);
		expect(elements.filter((element) => element.tag === "ul")).toHaveLength(sections.filter((section) => section.list.length > 0).length);
	});
});

describe("expectedOnboarding()", () => {
	it("gives the title, the intro and the practices of the strings, in order", () => {
		const strings = selectStrings("en");
		expect(expectedOnboarding(strings)).toEqual({ title: strings.onboardingTitle, intro: strings.onboardingIntro, items: practices(strings) });
		expect(expectedOnboarding(strings).items).toHaveLength(4);
	});

	it("follows the language of the strings", () => {
		const ru = expectedOnboarding(selectStrings("ru"));
		expect(ru.title).toBe(selectStrings("ru").onboardingTitle);
		expect(ru.title).not.toBe(expectedOnboarding(selectStrings("en")).title);
		expect(ru.items).toEqual(practices(selectStrings("ru")));
	});
});
