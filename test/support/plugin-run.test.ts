// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { selectStrings } from "../../src/ui/i18n/strings";
import { Editor, MarkdownView, Plugin, PluginSettingTab, TFile } from "../fakes/obsidian";
import { FakeApp } from "../fakes/obsidian-app";
import {
	PLUGIN_WAIT,
	RequestsUnderWay,
	buttonIn,
	enterLoginCode,
	fieldIn,
	openConnectWindow,
	openDropbox,
	pluginManifest,
	rowButton,
	runCommand,
	typeInto,
} from "./plugin-run";

const strings = selectStrings("en");

afterEach(() => {
	vi.useRealTimers();
	document.body.replaceChildren();
});

/** A fake plugin to add commands to. */
function plugin(): Plugin {
	return new Plugin({}, { id: "obsync", version: "0.1.0" });
}

describe("the plugin's manifest in tests", () => {
	it("puts the plugin's folder under the vault's configuration folder", () => {
		const app = new FakeApp();

		expect(pluginManifest(app)).toEqual({ id: "obsync", version: "0.1.0", dir: `${app.vault.configDir}/plugins/obsync` });
	});
});

describe("running a command", () => {
	it("runs a command's callback", () => {
		const added = plugin();
		let runs = 0;
		added.addCommand({ id: "go", name: "Go", callback: () => (runs += 1) });

		runCommand(added, "go");

		expect(runs).toBe(1);
	});

	it("runs a command offered now, asking first whether it is", () => {
		const added = plugin();
		const calls: boolean[] = [];
		added.addCommand({ id: "go", name: "Go", checkCallback: (checking) => (calls.push(checking), true) });

		runCommand(added, "go");

		expect(calls).toEqual([true, false]);
	});

	it("fails for a command not offered now, without running it", () => {
		const added = plugin();
		const calls: boolean[] = [];
		added.addCommand({ id: "go", name: "Go", checkCallback: (checking) => (calls.push(checking), false) });

		expect(() => runCommand(added, "go")).toThrow(/not offered/);
		expect(calls).toEqual([true]);
	});

	it("runs an editor command on the editor of the note open in front", () => {
		const added = plugin();
		const calls: unknown[][] = [];
		added.addCommand({ id: "go", name: "Go", editorCallback: (editor, view) => calls.push([editor, view]) });
		const file = new TFile("note.md", { size: 0, ctime: 0, mtime: 0 });
		const view = new MarkdownView(file, new Editor("hello"), () => Promise.resolve());

		runCommand(added, "go", view);

		expect(calls).toEqual([[view.editor, view]]);
	});

	it("fails for an editor command with no note open in an editor, without running it", () => {
		const added = plugin();
		let runs = 0;
		added.addCommand({ id: "go", name: "Go", editorCallback: () => (runs += 1) });

		expect(() => runCommand(added, "go")).toThrow(/not offered/);
		expect(runs).toBe(0);
	});

	it("fails for a command the plugin does not have", () => {
		expect(() => runCommand(plugin(), "missing")).toThrow(/no command missing/);
	});
});

describe("finding a button", () => {
	it("finds the button with the text under the element only", () => {
		const inside = document.body.createDiv();
		const outside = document.body.createDiv();
		const wanted = inside.createEl("button", { text: "Sync now" });
		outside.createEl("button", { text: "Connect" });

		expect(buttonIn(inside, "Sync now")).toBe(wanted);
		expect(() => buttonIn(inside, "Connect")).toThrow(/no button Connect/);
	});
});

describe("finding a settings row's field and button", () => {
	/** A settings row named `name` under `parent`, holding an input and a button with `text`. */
	function row(parent: HTMLElement, name: string, text: string): HTMLElement {
		const element = parent.createDiv({ cls: "setting-item" });
		element.createDiv({ cls: "setting-item-name", text: name });
		element.createEl("input");
		element.createEl("button", { text });
		return element;
	}

	it("finds the field and the button of the row with the name", () => {
		const root = document.body.createDiv();
		row(root, "Laptop", "Use");
		const wanted = row(root, "Phone", "Use");

		expect(fieldIn(root, "Phone")).toBe(wanted.querySelector("input"));
		expect(rowButton(root, "Phone", "Use")).toBe(wanted.querySelector("button"));
	});

	it("fails for a row that is not there, and for a row without a field", () => {
		const root = document.body.createDiv();
		const bare = root.createDiv({ cls: "setting-item" });
		bare.createDiv({ cls: "setting-item-name", text: "Bare" });

		expect(() => fieldIn(root, "Missing")).toThrow(/no settings row Missing/);
		expect(() => fieldIn(root, "Bare")).toThrow(/no field/);
	});

	it("types into a field so that its input listeners hear the value", () => {
		const input = document.body.createEl("input");
		const heard: string[] = [];
		input.addEventListener("input", () => heard.push(input.value));

		typeInto(input, "code-1");

		expect(heard).toEqual(["code-1"]);
	});
});

describe("starting to connect", () => {
	it("shows the settings tab under the element and presses its Connect", () => {
		const added = plugin();
		const tab = new PluginSettingTab({}, added);
		added.addSettingTab(tab);
		const pressed: string[] = [];
		tab.containerEl.createEl("button", { text: strings.connect }).addEventListener("click", () => pressed.push("connect"));
		const root = document.body.createDiv();

		openConnectWindow(root, added);

		expect(tab.containerEl.parentElement).toBe(root);
		expect(pressed).toEqual(["connect"]);
	});

	it("fails for a plugin without a settings tab", () => {
		expect(() => openConnectWindow(document.body.createDiv(), plugin())).toThrow(/no settings tab/);
	});

	it("presses Open Dropbox once the window shows it", async () => {
		const root = document.body.createDiv();
		const pressed: string[] = [];
		window.setTimeout(() => {
			root.createEl("button", { text: strings.openDropbox }).addEventListener("click", () => pressed.push("open"));
		}, 50);

		await openDropbox(root);

		expect(pressed).toEqual(["open"]);
	});

	it("types the login code, then presses Continue", () => {
		const root = document.body.createDiv();
		const row = root.createDiv({ cls: "setting-item" });
		row.createDiv({ cls: "setting-item-name", text: strings.loginCode });
		const input = row.createEl("input");
		const heard: string[] = [];
		input.addEventListener("input", () => heard.push(`typed ${input.value}`));
		root.createEl("button", { text: strings.continue }).addEventListener("click", () => heard.push("continue"));

		enterLoginCode(root, "code-1");

		expect(heard).toEqual(["typed code-1", "continue"]);
	});
});

describe("the requests under way", () => {
	it("settles only once a request held for a while has finished", async () => {
		const requests = new RequestsUnderWay();
		let finished = false;
		const send = requests.counting(
			() =>
				new Promise<void>((resolve) =>
					window.setTimeout(() => {
						finished = true;
						resolve();
					}, 200),
				),
		);

		const sent = send(undefined);
		await requests.settle();

		expect(finished).toBe(true);
		await sent;
	});

	it("passes a request's answer and its failure through", async () => {
		const requests = new RequestsUnderWay();

		await expect(requests.counting((value: number) => Promise.resolve(value * 2))(21)).resolves.toBe(42);
		await expect(requests.counting(() => Promise.reject(new Error("refused")))(undefined)).rejects.toThrow("refused");
		// A failed request is no longer under way.
		await requests.settle();
	});

	it("fails to settle while a request stays under way", async () => {
		vi.useFakeTimers();
		const requests = new RequestsUnderWay();
		void requests.counting(() => new Promise<void>(() => undefined))(undefined);

		const settled = requests.settle();
		const failure = expect(settled).rejects.toThrow(/still under way/);
		await vi.advanceTimersByTimeAsync(PLUGIN_WAIT.timeout + 100);

		await failure;
	});
});
