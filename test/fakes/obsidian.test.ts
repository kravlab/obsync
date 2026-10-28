// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
// The fake itself, by path: its test-only parts are not in Obsidian's typings.
import {
	ButtonComponent,
	Editor,
	MarkdownRenderChild,
	MarkdownRenderer,
	MarkdownView,
	Modal,
	Notice,
	Platform,
	Plugin,
	PluginSettingTab,
	PostProcessorContext,
	Setting,
	SuggestModal,
	TextAreaComponent,
	TextComponent,
	TFile,
	TFolder,
	ToggleComponent,
	answerRequestsWith,
	apiVersion,
	getLanguage,
	language,
	requestUrl,
	requireApiVersion,
	resetObsidianFake,
	setIcon,
	setTooltip,
	showInto,
} from "./obsidian";

afterEach(() => {
	document.body.replaceChildren();
});

describe("the fake obsidian module's element helpers", () => {
	it("creates an element with classes, text and attributes, appended last", () => {
		const parent = document.body.createDiv();
		parent.createSpan();

		const child = parent.createEl("p", { cls: "first second", text: "Hello", attr: { "data-x": "1", hidden: true } });

		expect(parent.lastElementChild).toBe(child);
		expect(child.outerHTML).toBe('<p class="first second" data-x="1" hidden="true">Hello</p>');
	});

	it("takes a class string in place of the options", () => {
		const child = document.body.createDiv("one");

		expect(child.className).toBe("one");
	});

	it("takes classes as an array, and drops empty parts of a class string", () => {
		const fromArray = document.body.createDiv({ cls: ["a", "b"] });
		const fromSpaces = document.body.createDiv({ cls: " a  b " });
		const fromEmpty = document.body.createDiv({ cls: "" });

		expect(fromArray.className).toBe("a b");
		expect(fromSpaces.className).toBe("a b");
		expect(fromEmpty.className).toBe("");
	});

	it("sets title, value, type, placeholder and href", () => {
		const input = document.body.createEl("input", { title: "Tip", value: "v", type: "text", placeholder: "Type" });
		const link = document.body.createEl("a", { href: "https://example.com/" });

		expect(input.title).toBe("Tip");
		expect(input.value).toBe("v");
		expect(input.type).toBe("text");
		expect(input.placeholder).toBe("Type");
		expect(link.href).toBe("https://example.com/");
	});

	it("leaves out an attribute given as null", () => {
		const child = document.body.createDiv({ attr: { "data-gone": null } });

		expect(child.hasAttribute("data-gone")).toBe(false);
	});

	it("takes a fragment as the text", () => {
		const fragment = new DocumentFragment();
		fragment.append(document.body.createEl("strong", { text: "Bold" }));

		const child = document.body.createDiv({ text: fragment });

		expect(child.innerHTML).toBe("<strong>Bold</strong>");
	});

	it("puts the element first with prepend, and into another parent with parent", () => {
		const parent = document.body.createDiv();
		const other = document.body.createDiv();
		parent.createSpan();

		const first = parent.createEl("p", { prepend: true });
		const elsewhere = parent.createEl("p", { parent: other });

		expect(parent.firstElementChild).toBe(first);
		expect(elsewhere.parentElement).toBe(other);
	});

	it("calls the callback with the element before appending it", () => {
		const parent = document.body.createDiv();
		let attachedDuringCallback: boolean | undefined;

		const child = parent.createEl("p", undefined, (element) => {
			attachedDuringCallback = element.parentElement !== null;
			element.createSpan({ text: "inside" });
		});

		expect(attachedDuringCallback).toBe(false);
		expect(child.innerHTML).toBe("<span>inside</span>");
	});

	it("rejects an option Obsidian does not have", () => {
		expect(() => document.body.createDiv({ colour: "red" } as never)).toThrow(/colour/);
	});

	it("empties an element", () => {
		const parent = document.body.createDiv();
		parent.createSpan();

		parent.empty();

		expect(parent.childNodes).toHaveLength(0);
	});

	it("sets text, or a fragment, as the whole content", () => {
		const element = document.body.createDiv();
		element.createSpan();
		const fragment = new DocumentFragment();
		fragment.append(document.body.createEl("em"));

		element.setText("Plain");
		const plain = element.innerHTML;
		element.setText(fragment);

		expect(plain).toBe("Plain");
		expect(element.innerHTML).toBe("<em></em>");
	});

	it("adds, removes and toggles classes", () => {
		const element = document.body.createDiv();

		element.addClass("foo", "bar");
		element.removeClass("bar");
		element.toggleClass(["baz", "qux"], true);
		element.toggleClass("foo", false);

		expect(element.className).toBe("baz qux");
	});

	it("sets an attribute, and removes it with null", () => {
		const element = document.body.createDiv();

		element.setAttr("data-foo", "bar");
		const set = element.getAttribute("data-foo");
		element.setAttr("data-foo", null);

		expect(set).toBe("bar");
		expect(element.hasAttribute("data-foo")).toBe(false);
	});
});

describe("the fake obsidian module's components", () => {
	it("builds a button in its container, with text, call to action and click handler", () => {
		const container = document.body.createDiv();
		const clicks: number[] = [];

		const button = new ButtonComponent(container)
			.setButtonText("Continue")
			.setCta()
			.onClick(() => clicks.push(1));
		button.buttonEl.click();

		expect(button.buttonEl.parentElement).toBe(container);
		expect(button.buttonEl.textContent).toBe("Continue");
		expect(button.buttonEl.classList.contains("mod-cta")).toBe(true);
		expect(clicks).toEqual([1]);
	});

	it("builds a text field that reports input but not its own setValue", () => {
		const container = document.body.createDiv();
		const reported: string[] = [];

		const text = new TextComponent(container).onChange((value) => reported.push(value));
		text.setValue("set");
		text.inputEl.value = "typed";
		text.inputEl.dispatchEvent(new Event("input"));

		expect(text.inputEl.parentElement).toBe(container);
		expect(text.getValue()).toBe("typed");
		expect(reported).toEqual(["typed"]);
	});

	it("builds a settings row with its name and description", () => {
		const container = document.body.createDiv();

		const setting = new Setting(container).setName("Code").setDesc("Paste it here");

		expect(setting.settingEl.parentElement).toBe(container);
		expect(setting.nameEl.textContent).toBe("Code");
		expect(setting.descEl.textContent).toBe("Paste it here");
	});

	it("puts a settings row's button and text field among its controls", () => {
		const setting = new Setting(document.body.createDiv());
		let button: ButtonComponent | undefined;
		let text: TextComponent | undefined;

		setting.addText((field) => (text = field)).addButton((created) => (button = created));

		expect(text?.inputEl.parentElement).toBe(setting.controlEl);
		expect(button?.buttonEl.parentElement).toBe(setting.controlEl);
	});
});

describe("the fake obsidian module's notices, modals and reset", () => {
	it("keeps every notice shown", () => {
		new Notice("First notice");
		new Notice("Second notice");

		expect(Notice.shown).toEqual(["First notice", "Second notice"]);
	});

	it("shows a modal's title and runs its hooks when it opens and closes", () => {
		const calls: string[] = [];
		class Probe extends Modal {
			override onOpen(): void {
				calls.push("open");
			}
			override onClose(): void {
				calls.push("close");
			}
		}
		const modal = new Probe({}).setTitle("Connect");

		modal.open();
		const attached = document.body.contains(modal.modalEl);
		modal.close();

		expect(modal.titleEl.textContent).toBe("Connect");
		expect(attached).toBe(true);
		expect(calls).toEqual(["open", "close"]);
		expect(document.body.contains(modal.modalEl)).toBe(false);
	});

	it("opens a modal again after it was closed", () => {
		const modal = new Modal({});

		modal.open();
		modal.close();
		modal.open();

		expect(document.body.contains(modal.modalEl)).toBe(true);
	});

	it("resets the notices, the platform flags, the language and the requestUrl handler", async () => {
		new Notice("Left over");
		Platform.isPhone = true;
		Platform.isDesktop = false;
		language.code = "ru";
		answerRequestsWith(() => Promise.resolve(response(200)));

		resetObsidianFake();

		expect(Notice.shown).toEqual([]);
		expect(Platform.isPhone).toBe(false);
		expect(Platform.isDesktop).toBe(true);
		expect(getLanguage()).toBe("en");
		await expect(requestUrl({ url: "https://example.com/" })).rejects.toThrow(/no requestUrl handler/);
	});
});

/** A response of `status` with an empty body. */
function response(status: number) {
	return { status, headers: {}, text: "", arrayBuffer: new ArrayBuffer(0) };
}

describe("the fake obsidian module's app-wide functions", () => {
	it("tells versions up to the one it plays as available, and later ones as not", () => {
		expect(requireApiVersion(apiVersion)).toBe(true);
		expect(requireApiVersion("1.0.0")).toBe(true);
		expect(requireApiVersion("1.12")).toBe(true);
		expect(requireApiVersion("1.13.0")).toBe(false);
	});

	it("gives the language a test sets", () => {
		language.code = "ru";

		expect(getLanguage()).toBe("ru");
	});

	it("answers requestUrl through the handler a test sets", async () => {
		answerRequestsWith((request) => Promise.resolve({ ...response(200), text: request.url }));

		expect((await requestUrl({ url: "https://example.com/a", throw: false })).text).toBe("https://example.com/a");
	});

	it("rejects a failed status unless told not to throw, as requestUrl does", async () => {
		answerRequestsWith(() => Promise.resolve(response(404)));

		await expect(requestUrl({ url: "https://example.com/" })).rejects.toThrow(/404/);
		expect((await requestUrl({ url: "https://example.com/", throw: false })).status).toBe(404);
	});

	it("keeps an icon and a tooltip on the element", () => {
		const element = document.body.createDiv();

		setIcon(element, "refresh-cw");
		setTooltip(element, "Synced");

		expect(element.getAttribute("data-icon")).toBe("refresh-cw");
		expect(element.getAttribute("aria-label")).toBe("Synced");
	});
});

describe("the fake obsidian module's visibility helpers", () => {
	it("hides, shows and toggles an attached element", () => {
		const element = document.body.createDiv();

		element.hide();
		const hidden = element.isShown();
		element.show();
		const shown = element.isShown();
		element.toggle(false);

		expect(hidden).toBe(false);
		expect(shown).toBe(true);
		expect(element.isShown()).toBe(false);
	});

	it("tells an element inside a hidden one, or not in the document, as not shown", () => {
		const parent = document.body.createDiv();
		const child = parent.createSpan();
		const detached = document.body.createDiv();
		detached.remove();

		parent.hide();

		expect(child.isShown()).toBe(false);
		expect(detached.isShown()).toBe(false);
	});
});

describe("the fake obsidian module's other components", () => {
	it("builds a toggle that reports a switch but not its own setValue", () => {
		const reported: boolean[] = [];

		const toggle = new ToggleComponent(document.body.createDiv()).onChange((on) => reported.push(on));
		toggle.setValue(true);
		toggle.toggleEl.checked = false;
		toggle.toggleEl.dispatchEvent(new Event("change"));

		expect(toggle.getValue()).toBe(false);
		expect(reported).toEqual([false]);
	});

	it("builds a text area that reports input but not its own setValue", () => {
		const reported: string[] = [];

		const area = new TextAreaComponent(document.body.createDiv()).onChange((value) => reported.push(value));
		area.setValue("set");
		area.inputEl.value = "typed";
		area.inputEl.dispatchEvent(new Event("input"));

		expect(area.getValue()).toBe("typed");
		expect(reported).toEqual(["typed"]);
	});

	it("adds a toggle to a settings row and shows a row as a heading", () => {
		const setting = new Setting(document.body.createDiv());
		let toggle: ToggleComponent | undefined;

		setting.addToggle((created) => (toggle = created)).setHeading();

		expect(toggle?.toggleEl.parentElement).toBe(setting.controlEl);
		expect(setting.settingEl.classList.contains("setting-item-heading")).toBe(true);
	});

	it("gives a suggest modal a field with its placeholder, and no suggestions of its own", async () => {
		const modal = new SuggestModal<string>({});

		modal.setPlaceholder("Pick one");

		expect(modal.inputEl.placeholder).toBe("Pick one");
		expect(await modal.getSuggestions("anything")).toEqual([]);
	});

	it("renders Markdown as its plain text", async () => {
		const element = document.body.createDiv();

		await MarkdownRenderer.render({}, "**bold**", element);

		expect(element.textContent).toBe("**bold**");
	});

	it("keeps a render child's element", () => {
		const element = document.body.createDiv();

		expect(new MarkdownRenderChild(element).containerEl).toBe(element);
	});
});

describe("the fake obsidian module's files and folders", () => {
	it("names a file by its path, with its extension and basename", () => {
		const file = new TFile("notes/report.final.md", { size: 3, ctime: 1, mtime: 2 });

		expect(file.name).toBe("report.final.md");
		expect(file.extension).toBe("md");
		expect(file.basename).toBe("report.final");
	});

	it("gives a name without a dot, or with its only dot first, no extension", () => {
		expect(new TFile("README", { size: 0, ctime: 0, mtime: 0 }).extension).toBe("");
		expect(new TFile(".hidden", { size: 0, ctime: 0, mtime: 0 }).basename).toBe(".hidden");
	});

	it("tells the root folder from others", () => {
		expect(new TFolder("/").isRoot()).toBe(true);
		expect(new TFolder("notes").isRoot()).toBe(false);
	});
});

describe("the fake obsidian module's global element helpers", () => {
	it("creates an element in the main document, attached only to a parent given", () => {
		const parent = document.body.createDiv();

		const loose = createDiv({ cls: "a b", text: "loose" });
		const span = createSpan("c");
		let connectedInCallback: boolean | undefined;
		const attached = createEl("p", { text: "Attached", parent }, (element) => {
			element.setAttr("data-made", "yes");
			connectedInCallback = element.isConnected;
		});
		const first = createDiv({ parent, prepend: true });

		expect(loose.isConnected).toBe(false);
		expect([...loose.classList]).toEqual(["a", "b"]);
		expect(loose.textContent).toBe("loose");
		expect(span.tagName).toBe("SPAN");
		expect(span.className).toBe("c");
		expect([...parent.children]).toEqual([first, attached]);
		expect(attached.getAttribute("data-made")).toBe("yes");
		// The callback runs before the element is appended.
		expect(connectedInCallback).toBe(false);
	});

	it("tells the window a node belongs to", () => {
		expect(document.body.createDiv().win).toBe(window);
		expect(document.createTextNode("text").win).toBe(window);
		expect(document.win).toBe(window);
	});
});

describe("the fake obsidian module's post processor context", () => {
	it("tells the same section for every element, or null, and keeps the children added", () => {
		const section = { text: "a\nb", lineStart: 0, lineEnd: 1 };
		const context = new PostProcessorContext("note.md", section);
		const child = new MarkdownRenderChild(createDiv());

		context.addChild(child);

		expect(context.sourcePath).toBe("note.md");
		expect(context.getSectionInfo(createEl("p"))).toBe(section);
		expect(context.children).toEqual([child]);
		expect(new PostProcessorContext("note.md", null).getSectionInfo(createEl("p"))).toBeNull();
	});
});

describe("the fake obsidian module's editor and Markdown view", () => {
	it("turns offsets into positions and back, by line and character", () => {
		const editor = new Editor("one\ntwo\n");

		expect(editor.offsetToPos(0)).toEqual({ line: 0, ch: 0 });
		expect(editor.offsetToPos(5)).toEqual({ line: 1, ch: 1 });
		expect(editor.offsetToPos(8)).toEqual({ line: 2, ch: 0 });
		expect(editor.posToOffset({ line: 1, ch: 1 })).toBe(5);
		expect(editor.posToOffset({ line: 2, ch: 0 })).toBe(8);
	});

	it("fails with a RangeError for an offset or a position outside the text", () => {
		const editor = new Editor("one\ntwo");

		expect(editor.offsetToPos(7)).toEqual({ line: 1, ch: 3 });
		expect(() => editor.offsetToPos(8)).toThrow(RangeError);
		expect(() => editor.offsetToPos(-1)).toThrow(RangeError);
		expect(() => editor.posToOffset({ line: 0, ch: 4 })).toThrow(RangeError);
		expect(() => editor.posToOffset({ line: 2, ch: 0 })).toThrow(RangeError);
		expect(() => editor.setCursor(0, 9)).toThrow(RangeError);
	});

	it("puts the cursor at a position or at a line and character, at the start until then", () => {
		const editor = new Editor("one\ntwo\n");

		expect(editor.getCursor()).toEqual({ line: 0, ch: 0 });
		editor.setCursor({ line: 1, ch: 2 });
		expect(editor.getCursor()).toEqual({ line: 1, ch: 2 });
		editor.setCursor(0);
		expect(editor.getCursor()).toEqual({ line: 0, ch: 0 });
		editor.setCursor(1, 3);
		expect(editor.getCursor()).toEqual({ line: 1, ch: 3 });
	});

	it("replaces a range, or inserts at a position, and tells each change", () => {
		let changes = 0;
		const editor = new Editor("one two three", () => (changes += 1));

		editor.replaceRange("2", { line: 0, ch: 4 }, { line: 0, ch: 7 });
		editor.replaceRange("zero ", { line: 0, ch: 0 });

		expect(editor.getValue()).toBe("zero one 2 three");
		expect(changes).toBe(2);
	});

	it("scrolls a range into view without changing the text or the cursor", () => {
		const editor = new Editor("one\ntwo");
		editor.setCursor(1, 1);

		editor.scrollIntoView();

		expect(editor.getValue()).toBe("one\ntwo");
		expect(editor.getCursor()).toEqual({ line: 1, ch: 1 });
	});

	// The cases checked against CodeMirror 6's own mapping of a cursor through a change.
	it.each([
		{ at: "an insertion at the cursor", cursor: 1, from: 1, to: 1, expected: 1 },
		{ at: "the start of the range", cursor: 1, from: 1, to: 2, expected: 1 },
		{ at: "the end of the range", cursor: 2, from: 1, to: 2, expected: 3 },
	])("maps a cursor at $at as CodeMirror 6 does", ({ cursor, from, to, expected }) => {
		const editor = new Editor("abc");
		editor.setCursor(0, cursor);

		editor.replaceRange("XX", { line: 0, ch: from }, { line: 0, ch: to });

		expect(editor.getCursor()).toEqual({ line: 0, ch: expected });
	});

	it("moves a cursor after the range with its text, leaves one before it, and puts one inside at its start", () => {
		const after = new Editor("one\ntwo\nthree");
		after.setCursor(2, 3);
		after.replaceRange("ONE, longer", { line: 0, ch: 0 }, { line: 0, ch: 3 });
		const before = new Editor("one\ntwo\nthree");
		before.setCursor(0, 2);
		before.replaceRange("TWO\nand more", { line: 1, ch: 0 }, { line: 1, ch: 3 });
		const inside = new Editor("one\ntwo\nthree");
		inside.setCursor(1, 2);
		inside.replaceRange("x", { line: 1, ch: 0 }, { line: 2, ch: 1 });

		expect(after.getCursor()).toEqual({ line: 2, ch: 3 });
		expect(before.getCursor()).toEqual({ line: 0, ch: 2 });
		expect(inside.getCursor()).toEqual({ line: 1, ch: 0 });
	});

	it("saves the editor's text through the view's writer", async () => {
		const file = new TFile("note.md", { size: 0, ctime: 0, mtime: 0 });
		const saved: string[] = [];
		const view = new MarkdownView(file, new Editor("hello"), (text) => {
			saved.push(text);
			return Promise.resolve();
		});

		view.editor.replaceRange(" world", { line: 0, ch: 5 });
		await view.save();

		expect(view.file).toBe(file);
		expect(saved).toEqual(["hello world"]);
	});
});

describe("the fake obsidian module's plugin", () => {
	/** A plugin of a fake app with a manifest. */
	const plugin = (): Plugin => new Plugin({}, { id: "test", version: "1.0.0" });

	it("keeps the commands, settings tabs, editor extensions and post processors it adds", () => {
		const added = plugin();
		const tab = new PluginSettingTab({}, added);

		added.addCommand({ id: "go", name: "Go", callback: () => undefined });
		added.addSettingTab(tab);
		added.registerEditorExtension("extension");
		added.registerMarkdownPostProcessor("processor");

		expect(added.commands.map((command) => command.id)).toEqual(["go"]);
		expect(added.settingTabs).toEqual([tab]);
		expect(tab.plugin).toBe(added);
		expect(added.editorExtensions).toEqual(["extension"]);
		expect(added.postProcessors).toEqual(["processor"]);
	});

	it("adds a ribbon icon that runs its action, and a status bar item, both removed on unload", () => {
		const added = plugin();
		let clicks = 0;

		const icon = added.addRibbonIcon("refresh-cw", "Sync", () => (clicks += 1));
		const item = added.addStatusBarItem();
		icon.click();
		added.unload();

		expect(clicks).toBe(1);
		expect(icon.getAttribute("aria-label")).toBe("Sync");
		expect(document.body.contains(icon)).toBe(false);
		expect(document.body.contains(item)).toBe(false);
	});

	it("shows modals, ribbon icons and status bar items in the element given by showInto", () => {
		const own = document.body.createDiv();
		const added = plugin();

		showInto(own);
		const modal = new Modal({});
		modal.open();
		const icon = added.addRibbonIcon("refresh-cw", "Sync", () => undefined);
		const item = added.addStatusBarItem();

		expect([modal.modalEl, icon, item].map((element) => element.parentElement)).toEqual([own, own, own]);
	});

	it("shows modals in the document's body again after a reset", () => {
		showInto(document.body.createDiv());

		resetObsidianFake();
		const modal = new Modal({});
		modal.open();

		expect(modal.modalEl.parentElement).toBe(document.body);
	});

	it("runs onunload, then every cleanup newest first, on unload, and the cleanups only once", () => {
		const calls: string[] = [];
		class Probe extends Plugin {
			override onunload(): void {
				calls.push("onunload");
			}
		}
		const added = new Probe({}, { id: "test", version: "1.0.0" });
		added.register(() => calls.push("first"));
		added.registerEvent({ off: () => calls.push("event") });

		added.unload();
		added.unload();

		expect(calls.filter((call) => call !== "onunload")).toEqual(["event", "first"]);
		expect(calls[0]).toBe("onunload");
		expect(added.unloaded).toBe(true);
	});

	it("listens for a DOM event until unload", () => {
		const added = plugin();
		const target = document.body.createDiv();
		let heard = 0;
		added.registerDomEvent(target, "click", () => (heard += 1));

		target.click();
		added.unload();
		target.click();

		expect(heard).toBe(1);
	});
});
