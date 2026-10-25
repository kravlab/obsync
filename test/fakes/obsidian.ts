/**
 * A fake of the `obsidian` module for tests that build the plugin's
 * windows, or run the whole plugin, in jsdom (spec of the review fixes,
 * item 20). The real package ships typings only, so vitest resolves
 * `obsidian` here. It holds the parts the plugin uses, behaving as
 * Obsidian's typings document where a test can see it:
 *
 * - the element helpers (`createEl`, `empty`, `setText`, `hide`, …) and
 *   the `activeWindow` global;
 * - modals, settings rows and their components, notices, settings tabs;
 * - the plugin, which keeps what it adds and undoes it on `unload`;
 * - the index's files and folders, Markdown rendering as plain text;
 * - the platform flags, the language, the API version, and `requestUrl`,
 *   answered by the handler a test sets (`answerRequestsWith`).
 *
 * The App itself is in obsidian-app.ts. The fake grows with the tests
 * that need more of Obsidian; an element option it does not know fails
 * loudly instead of being ignored.
 */

/** What Obsidian's `createEl` takes besides the tag (`DomElementInfo`). */
interface ElementInfo {
	/** Classes, space-separated or as a list. */
	readonly cls?: string | readonly string[];
	/** The text content, or a fragment to put inside. */
	readonly text?: string | DocumentFragment;
	/** Attributes to set; `null` leaves one out. */
	readonly attr?: Readonly<Record<string, string | number | boolean | null>>;
	/** The hover tooltip. */
	readonly title?: string;
	/** The node to append to, in place of the one `createEl` is called on. */
	readonly parent?: Node;
	/** The value of an `<input>`, `<select>` or `<option>`. */
	readonly value?: string;
	/** The type of an `<input>` or `<style>`. */
	readonly type?: string;
	/** Whether to insert the element first instead of last. */
	readonly prepend?: boolean;
	/** The placeholder of an `<input>`. */
	readonly placeholder?: string;
	/** The link of an `<a>`, `<link>` or `<base>`. */
	readonly href?: string;
}

/** The options `createEl` knows; any other is a mistake in the code under test. */
const ELEMENT_OPTIONS: ReadonlySet<string> = new Set([
	"cls",
	"text",
	"attr",
	"title",
	"parent",
	"value",
	"type",
	"prepend",
	"placeholder",
	"href",
]);

/** The element helpers Obsidian adds to every `HTMLElement`. */
interface ElementHelpers {
	/** Creates a `tag` element as `info` says, passes it to `callback`, then appends it. */
	createEl<K extends keyof HTMLElementTagNameMap>(
		tag: K,
		info?: ElementInfo | string,
		callback?: (element: HTMLElementTagNameMap[K]) => void,
	): HTMLElementTagNameMap[K];
	/** `createEl("div", …)`. */
	createDiv(info?: ElementInfo | string, callback?: (element: HTMLDivElement) => void): HTMLDivElement;
	/** `createEl("span", …)`. */
	createSpan(info?: ElementInfo | string, callback?: (element: HTMLSpanElement) => void): HTMLSpanElement;
	/** Removes every child. */
	empty(): void;
	/** Replaces the content with `text`, or with a fragment's nodes. */
	setText(text: string | DocumentFragment): void;
	/** Adds `classes`. */
	addClass(...classes: string[]): void;
	/** Removes `classes`. */
	removeClass(...classes: string[]): void;
	/** Adds `classes` when `on`, removes them otherwise. */
	toggleClass(classes: string | readonly string[], on: boolean): void;
	/** Sets the attribute `name`, or removes it when `value` is null. */
	setAttr(name: string, value: string | number | boolean | null): void;
	/** Shows the element again. */
	show(): void;
	/** Hides the element. */
	hide(): void;
	/** Shows the element when `show`, hides it otherwise. */
	toggle(show: boolean): void;
	/** Whether the element is shown: in the document, with neither it nor an ancestor hidden. */
	isShown(): boolean;
}

/** The class names in `cls`: a list as it is, a string split at whitespace, empty parts dropped. */
function classNames(cls: string | readonly string[]): string[] {
	return (typeof cls === "string" ? cls.split(/\s+/) : [...cls]).filter((name) => name !== "");
}

/** Sets `value` as the content of `element`: text, or a fragment's nodes. */
function setContent(element: HTMLElement, value: string | DocumentFragment): void {
	if (typeof value === "string") element.textContent = value;
	else element.replaceChildren(value);
}

/** Applies `info`, `createEl`'s options without `parent` and `prepend`, to `element`. */
function applyInfo(element: HTMLElement, info: ElementInfo): void {
	const unknown = Object.keys(info).filter((name) => !ELEMENT_OPTIONS.has(name));
	if (unknown.length > 0) throw new Error(`fake obsidian: createEl has no option ${unknown.join(", ")}`);
	if (info.cls !== undefined) element.classList.add(...classNames(info.cls));
	if (info.text !== undefined) setContent(element, info.text);
	for (const [name, value] of Object.entries(info.attr ?? {})) {
		if (value !== null) element.setAttribute(name, String(value));
	}
	if (info.title !== undefined) element.title = info.title;
	if (info.value !== undefined) element.setAttribute("value", info.value);
	if (info.type !== undefined) element.setAttribute("type", info.type);
	if (info.placeholder !== undefined) element.setAttribute("placeholder", info.placeholder);
	if (info.href !== undefined) element.setAttribute("href", info.href);
}

/** Adds Obsidian's element helpers to jsdom's elements; in Node, where there is no DOM, it does nothing. */
function installElementHelpers(): void {
	if (typeof HTMLElement === "undefined") return;
	const helpers: ElementHelpers & ThisType<HTMLElement & ElementHelpers> = {
		createEl(tag, info, callback) {
			const element = this.ownerDocument.createElement(tag);
			const options: ElementInfo = typeof info === "string" ? { cls: info } : (info ?? {});
			applyInfo(element, options);
			callback?.(element);
			const parent = options.parent ?? this;
			if (options.prepend === true) parent.insertBefore(element, parent.firstChild);
			else parent.appendChild(element);
			return element;
		},
		createDiv(info, callback) {
			return this.createEl("div", info, callback);
		},
		createSpan(info, callback) {
			return this.createEl("span", info, callback);
		},
		empty() {
			this.replaceChildren();
		},
		setText(text) {
			setContent(this, text);
		},
		addClass(...classes) {
			this.classList.add(...classes);
		},
		removeClass(...classes) {
			this.classList.remove(...classes);
		},
		toggleClass(classes, on) {
			for (const name of typeof classes === "string" ? [classes] : classes) this.classList.toggle(name, on);
		},
		setAttr(name, value) {
			if (value === null) this.removeAttribute(name);
			else this.setAttribute(name, String(value));
		},
		show() {
			this.hidden = false;
		},
		hide() {
			this.hidden = true;
		},
		toggle(show) {
			this.hidden = !show;
		},
		isShown() {
			// `closest` looks at the element itself, then every ancestor.
			return this.isConnected && this.closest("[hidden]") === null;
		},
	};
	Object.assign(HTMLElement.prototype, helpers);
}

installElementHelpers();

// Obsidian's global for the window in focus; the fake has one window.
if (typeof window !== "undefined") Object.assign(window, { activeWindow: window });

/** The platform flags of a desktop app, the state every test starts from. */
const DESKTOP_PLATFORM = {
	isPhone: false,
	isMobile: false,
	isTablet: false,
	isIosApp: false,
	isAndroidApp: false,
	isDesktop: true,
} as const;

/** The platform flags; tests set them for the platform they play. */
export const Platform: { -readonly [K in keyof typeof DESKTOP_PLATFORM]: boolean } = { ...DESKTOP_PLATFORM };

/** A notice; every message shown is kept in `Notice.shown`, oldest first. */
export class Notice {
	/** The messages of every notice shown since the last reset. */
	static readonly shown: string[] = [];

	/** @param message the notice's text */
	constructor(message: string) {
		Notice.shown.push(message);
	}
}

/** The Obsidian version the fake plays: before 1.13, so settings tabs draw themselves (`display`). */
export const apiVersion = "1.12.7";

/** Whether the app is `version` or later, compared part by part. */
export function requireApiVersion(version: string): boolean {
	const parts = (text: string): number[] => text.split(".").map(Number);
	const [have, want] = [parts(apiVersion), parts(version)];
	for (let index = 0; index < Math.max(have.length, want.length); index += 1) {
		const difference = (have[index] ?? 0) - (want[index] ?? 0);
		if (difference !== 0) return difference > 0;
	}
	return true;
}

/** The language `getLanguage` gives; tests set it for the language they play. */
export const language = { code: "en" };

/** Obsidian's language code, as the app is set to. */
export function getLanguage(): string {
	return language.code;
}

/** One HTTP request as `requestUrl` takes it, as far as the plugin uses it. */
interface RequestUrlParam {
	readonly url: string;
	readonly method?: string;
	readonly contentType?: string;
	readonly body?: string | ArrayBuffer;
	readonly headers?: Readonly<Record<string, string>>;
	readonly throw?: boolean;
}

/** One HTTP response as `requestUrl` gives it, as far as the plugin uses it. */
interface RequestUrlResponse {
	readonly status: number;
	readonly headers: Readonly<Record<string, string>>;
	readonly text: string;
	readonly arrayBuffer: ArrayBuffer;
}

/** Who answers `requestUrl`: a fake service a test sets with `answerRequestsWith`. */
let requestHandler: ((request: RequestUrlParam) => Promise<RequestUrlResponse>) | undefined;

/** Makes `requestUrl` answer through `handler`, such as a fake Dropbox. */
export function answerRequestsWith(handler: (request: RequestUrlParam) => Promise<RequestUrlResponse>): void {
	requestHandler = handler;
}

/**
 * Sends `request` to the handler the test set; with none, the test forgot
 * one, and it fails. A status of 400 or more rejects unless `throw` is
 * false, as `requestUrl` does.
 */
export async function requestUrl(request: RequestUrlParam): Promise<RequestUrlResponse> {
	if (requestHandler === undefined) throw new Error("fake obsidian: no requestUrl handler set");
	const response = await requestHandler(request);
	if (response.status >= 400 && request.throw !== false) throw new Error(`Request failed, status ${response.status}`);
	return response;
}

/** Shows `icon` on `element`, kept as its `data-icon` attribute. */
export function setIcon(element: HTMLElement, icon: string): void {
	element.setAttribute("data-icon", icon);
}

/** Gives `element` the tooltip `text`, kept as its `aria-label` attribute, as Obsidian does. */
export function setTooltip(element: HTMLElement, text: string): void {
	element.setAttribute("aria-label", text);
}

/**
 * Puts the fake's shared state back as a test starts: no notices shown,
 * the desktop platform, English, no `requestUrl` handler. The vitest
 * setup file calls it before every test.
 */
export function resetObsidianFake(): void {
	Notice.shown.length = 0;
	Object.assign(Platform, DESKTOP_PLATFORM);
	language.code = "en";
	requestHandler = undefined;
}

/** A modal: its elements exist from construction, and `open` and `close` run its hooks. */
export class Modal {
	/** The modal's own element, holding the title and the content. */
	readonly modalEl: HTMLElement;
	/** Where the title is shown. */
	readonly titleEl: HTMLElement;
	/** Where the modal's content is built. */
	readonly contentEl: HTMLElement;

	/** @param app the app the modal belongs to */
	constructor(readonly app: unknown) {
		this.modalEl = document.createElement("div");
		this.titleEl = this.modalEl.createDiv();
		this.contentEl = this.modalEl.createDiv();
	}

	/** Sets the title shown above the content. */
	setTitle(title: string): this {
		this.titleEl.setText(title);
		return this;
	}

	/** Shows the modal in the document and runs `onOpen`. */
	open(): void {
		document.body.appendChild(this.modalEl);
		this.onOpen();
	}

	/** Takes the modal out of the document and runs `onClose`. */
	close(): void {
		this.modalEl.remove();
		this.onClose();
	}

	/** Called when the modal opens. */
	onOpen(): void {}

	/** Called when the modal closes. */
	onClose(): void {}
}

/** A button, created in its container as Obsidian's is. */
export class ButtonComponent {
	/** The button element. */
	readonly buttonEl: HTMLButtonElement;

	/** @param containerEl the element the button is added to */
	constructor(containerEl: HTMLElement) {
		this.buttonEl = containerEl.createEl("button");
	}

	/** Sets the button's text. */
	setButtonText(text: string): this {
		this.buttonEl.textContent = text;
		return this;
	}

	/** Marks the button as the call to action. */
	setCta(): this {
		this.buttonEl.classList.add("mod-cta");
		return this;
	}

	/** Runs `callback` on each click. */
	onClick(callback: (event: MouseEvent) => unknown): this {
		this.buttonEl.addEventListener("click", (event) => void callback(event));
		return this;
	}
}

/** A text field, created in its container as Obsidian's is. */
export class TextComponent {
	/** The input element. */
	readonly inputEl: HTMLInputElement;

	/** @param containerEl the element the field is added to */
	constructor(containerEl: HTMLElement) {
		this.inputEl = containerEl.createEl("input", { type: "text" });
	}

	/** Sets the field's value, without telling `onChange`. */
	setValue(value: string): this {
		this.inputEl.value = value;
		return this;
	}

	/** The field's value. */
	getValue(): string {
		return this.inputEl.value;
	}

	/** Runs `callback` with the value on each input. */
	onChange(callback: (value: string) => unknown): this {
		this.inputEl.addEventListener("input", () => void callback(this.inputEl.value));
		return this;
	}
}

/** A settings row in `containerEl`: a name, a description, and its controls. */
export class Setting {
	/** The row's element. */
	readonly settingEl: HTMLElement;
	/** Where the name is shown. */
	readonly nameEl: HTMLElement;
	/** Where the description is shown. */
	readonly descEl: HTMLElement;
	/** Where the buttons and fields go. */
	readonly controlEl: HTMLElement;

	/** @param containerEl the element the row is added to */
	constructor(containerEl: HTMLElement) {
		this.settingEl = containerEl.createDiv({ cls: "setting-item" });
		this.nameEl = this.settingEl.createDiv({ cls: "setting-item-name" });
		this.descEl = this.settingEl.createDiv({ cls: "setting-item-description" });
		this.controlEl = this.settingEl.createDiv({ cls: "setting-item-control" });
	}

	/** Sets the row's name. */
	setName(name: string): this {
		this.nameEl.setText(name);
		return this;
	}

	/** Sets the row's description. */
	setDesc(description: string): this {
		this.descEl.setText(description);
		return this;
	}

	/** Adds a button, set up by `build`. */
	addButton(build: (button: ButtonComponent) => unknown): this {
		build(new ButtonComponent(this.controlEl));
		return this;
	}

	/** Adds a text field, set up by `build`. */
	addText(build: (text: TextComponent) => unknown): this {
		build(new TextComponent(this.controlEl));
		return this;
	}

	/** Adds a toggle, set up by `build`. */
	addToggle(build: (toggle: ToggleComponent) => unknown): this {
		build(new ToggleComponent(this.controlEl));
		return this;
	}

	/** Shows the row as a heading. */
	setHeading(): this {
		this.settingEl.classList.add("setting-item-heading");
		return this;
	}
}

/** An on/off toggle, created in its container as Obsidian's is. */
export class ToggleComponent {
	/** The checkbox standing for the toggle. */
	readonly toggleEl: HTMLInputElement;

	/** @param containerEl the element the toggle is added to */
	constructor(containerEl: HTMLElement) {
		this.toggleEl = containerEl.createEl("input", { type: "checkbox" });
	}

	/** Sets the toggle, without telling `onChange`. */
	setValue(on: boolean): this {
		this.toggleEl.checked = on;
		return this;
	}

	/** Whether the toggle is on. */
	getValue(): boolean {
		return this.toggleEl.checked;
	}

	/** Runs `callback` with the new value on each switch. */
	onChange(callback: (on: boolean) => unknown): this {
		this.toggleEl.addEventListener("change", () => void callback(this.toggleEl.checked));
		return this;
	}
}

/** A multi-line text field, created in its container as Obsidian's is. */
export class TextAreaComponent {
	/** The textarea element. */
	readonly inputEl: HTMLTextAreaElement;

	/** @param containerEl the element the field is added to */
	constructor(containerEl: HTMLElement) {
		this.inputEl = containerEl.createEl("textarea");
	}

	/** Sets the field's value, without telling `onChange`. */
	setValue(value: string): this {
		this.inputEl.value = value;
		return this;
	}

	/** The field's value. */
	getValue(): string {
		return this.inputEl.value;
	}

	/** Runs `callback` with the value on each input. */
	onChange(callback: (value: string) => unknown): this {
		this.inputEl.addEventListener("input", () => void callback(this.inputEl.value));
		return this;
	}
}

/** A modal that suggests items as the user types; the plugin's own subclass draws them. */
export class SuggestModal<T> extends Modal {
	/** The field the user types into. */
	readonly inputEl: HTMLInputElement;

	/** @param app the app the modal belongs to */
	constructor(app: unknown) {
		super(app);
		this.inputEl = this.modalEl.createEl("input", { type: "text" });
	}

	/** Sets the hint shown in the empty field. */
	setPlaceholder(placeholder: string): void {
		this.inputEl.placeholder = placeholder;
	}

	/** The items matching `query`; the subclass gives them. */
	getSuggestions(_query: string): T[] | Promise<T[]> {
		return [];
	}
}

/** A file or folder in the vault's index. */
export class TAbstractFile {
	/** The vault path. */
	path: string;
	/** The last segment of the path. */
	name: string;

	/** @param path the vault path */
	constructor(path: string) {
		this.path = path;
		this.name = path.slice(path.lastIndexOf("/") + 1);
	}
}

/** A file in the vault's index, with its size and times. */
export class TFile extends TAbstractFile {
	/** Size in bytes, and creation and modification times in ms since the epoch. */
	stat: { size: number; ctime: number; mtime: number };

	/**
	 * @param path the vault path
	 * @param stat the file's size and times
	 */
	constructor(path: string, stat: { size: number; ctime: number; mtime: number }) {
		super(path);
		this.stat = stat;
	}

	/** The name after its last dot, without the dot; "" without one. */
	get extension(): string {
		const dot = this.name.lastIndexOf(".");
		return dot > 0 ? this.name.slice(dot + 1) : "";
	}

	/** The name without its extension. */
	get basename(): string {
		const dot = this.name.lastIndexOf(".");
		return dot > 0 ? this.name.slice(0, dot) : this.name;
	}
}

/** A folder in the vault's index; the root's path is "/". */
export class TFolder extends TAbstractFile {
	/** Whether this is the vault's root folder. */
	isRoot(): boolean {
		return this.path === "/";
	}
}

/** A Markdown view; the fake opens none, so only the class exists, for `instanceof`. */
export class MarkdownView {}

/** A child of rendered Markdown that lives as long as its element. */
export class MarkdownRenderChild {
	/** @param containerEl the element the child renders into */
	constructor(readonly containerEl: HTMLElement) {}

	/** Called once the child is added. */
	onload(): void {}

	/** Called once the child is removed. */
	onunload(): void {}
}

/** Renders Markdown into an element: the fake puts the source in as text. */
export const MarkdownRenderer = {
	/** Puts `markdown` into `element` as plain text. */
	render(_app: unknown, markdown: string, element: HTMLElement): Promise<void> {
		element.setText(markdown);
		return Promise.resolve();
	},
};

/** A command as the plugin adds it, as far as tests run it. */
interface Command {
	readonly id: string;
	readonly name: string;
	readonly callback?: () => unknown;
	readonly checkCallback?: (checking: boolean) => boolean | void;
	readonly editorCallback?: (...args: never[]) => unknown;
}

/** A handle to a registered event listener, which `off` removes. */
export interface FakeEventRef {
	/** Removes the listener. */
	off(): void;
}

/** What Obsidian gives a plugin about itself, as far as the plugin reads it. */
interface PluginManifest {
	readonly id: string;
	readonly version: string;
	readonly dir?: string;
}

/**
 * A plugin, with what it adds kept for tests to look at and run: its
 * commands, settings tabs, ribbon icons, status bar items, editor
 * extensions and Markdown post processors. `unload` plays disabling the
 * plugin: `onunload`, then every cleanup registered, newest first, an
 * order Obsidian's typings do not document.
 */
export class Plugin {
	/** The commands added, oldest first. */
	readonly commands: Command[] = [];
	/** The settings tabs added. */
	readonly settingTabs: PluginSettingTab[] = [];
	/** The ribbon icons added. */
	readonly ribbonIcons: HTMLElement[] = [];
	/** The status bar items added. */
	readonly statusBarItems: HTMLElement[] = [];
	/** The editor extensions registered. */
	readonly editorExtensions: unknown[] = [];
	/** The Markdown post processors registered. */
	readonly postProcessors: unknown[] = [];
	/** Whether `unload` ran. */
	unloaded = false;
	/** What `unload` undoes, oldest first. */
	private readonly cleanups: (() => void)[] = [];

	/**
	 * @param app the app the plugin runs in
	 * @param manifest the plugin's manifest
	 */
	constructor(
		readonly app: unknown,
		readonly manifest: PluginManifest,
	) {}

	/** Called when the plugin is enabled. */
	onload(): void | Promise<void> {}

	/** Called when the plugin is disabled. */
	onunload(): void {}

	/** Disables the plugin: `onunload`, then every cleanup, newest first. */
	unload(): void {
		this.unloaded = true;
		this.onunload();
		for (const cleanup of this.cleanups.splice(0).reverse()) cleanup();
	}

	/** Runs `cleanup` on unload. */
	register(cleanup: () => void): void {
		this.cleanups.push(cleanup);
	}

	/** Removes the listener `ref` stands for on unload. */
	registerEvent(ref: FakeEventRef): void {
		this.register(() => ref.off());
	}

	/** Listens for `type` on `target` until unload. */
	registerDomEvent(target: EventTarget, type: string, listener: (event: Event) => unknown): void {
		const handler = (event: Event): void => void listener(event);
		target.addEventListener(type, handler);
		this.register(() => target.removeEventListener(type, handler));
	}

	/** Adds `command`. */
	addCommand(command: Command): Command {
		this.commands.push(command);
		return command;
	}

	/** Adds `tab` to the settings. */
	addSettingTab(tab: PluginSettingTab): void {
		this.settingTabs.push(tab);
	}

	/** Adds a ribbon icon that runs `onClick`, removed on unload. */
	addRibbonIcon(icon: string, title: string, onClick: (event: MouseEvent) => unknown): HTMLElement {
		const element = document.body.createDiv({ cls: "side-dock-ribbon-action" });
		setIcon(element, icon);
		setTooltip(element, title);
		element.addEventListener("click", (event) => void onClick(event));
		this.ribbonIcons.push(element);
		this.register(() => element.remove());
		return element;
	}

	/** Adds a status bar item, removed on unload. */
	addStatusBarItem(): HTMLElement {
		const element = document.body.createDiv({ cls: "status-bar-item" });
		this.statusBarItems.push(element);
		this.register(() => element.remove());
		return element;
	}

	/** Registers an editor extension. */
	registerEditorExtension(extension: unknown): void {
		this.editorExtensions.push(extension);
	}

	/** Registers a Markdown post processor. */
	registerMarkdownPostProcessor(processor: unknown): void {
		this.postProcessors.push(processor);
	}
}

/** A plugin's settings tab: its element, which `display` fills. */
export class PluginSettingTab {
	/** Where the tab draws its rows. */
	readonly containerEl: HTMLElement;

	/**
	 * @param app the app the tab belongs to
	 * @param plugin the plugin owning the tab
	 */
	constructor(
		readonly app: unknown,
		readonly plugin: Plugin,
	) {
		this.containerEl = document.createElement("div");
	}

	/** Draws the tab. */
	display(): void {}

	/** Called when the tab is closed. */
	hide(): void {}
}
