// @vitest-environment jsdom
// Manual check 8 through the whole plugin, on Conflict blocks a real sync
// wrote: the action row the plugin's editor extension draws in a
// CodeMirror 6 editor resolves a block with each of its buttons, Edit…
// combines both sides, Next conflict and Previous conflict move the
// cursor, and the Reading view shows each block as a panel with both
// sides. How the markers render in Live Preview, and how Obsidian itself
// splits such a note into sections for the Reading view, are left to the
// desktop run: here the test gives the sections.
import "fake-indexeddb/auto";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { selectStrings } from "../../src/ui/i18n/strings";
import { fill } from "../../src/ui/i18n/fill";
import type { PostProcessorContext } from "../fakes/obsidian";
import { fileOn, remoteText, textOn, useDevices, type PluginDevice } from "../support/plugin-devices";
import { PLUGIN_WAIT, buttonIn } from "../support/plugin-run";
import { DEVICE_TEST_TIMEOUT_MS } from "../support/timeouts";

const strings = selectStrings("en");

const newDevices = useDevices();

/** The note on both devices before the conflict: its first and last lines change on both. */
const BEFORE = "first line\nmiddle one\nmiddle two\nmiddle three\nlast line\n";

/** The note's unchanged middle, between its two blocks. */
const MIDDLE = "middle one\nmiddle two\nmiddle three\n";

/** The block about the first line, on the device labelled `label`. */
function firstBlock(label: string): string {
	return `<<<<<<< ${label}\nfirst, mine\n=======\nfirst, theirs\n>>>>>>> Remote\n`;
}

/** The block about the last line, on the device labelled `label`. */
function lastBlock(label: string): string {
	return `<<<<<<< ${label}\nlast, mine\n=======\nlast, theirs\n>>>>>>> Remote\n`;
}

/** The lines, from 0, where the blocks of `text` start. */
function blockStarts(text: string): number[] {
	return text.split("\n").flatMap((line, index) => (line.startsWith("<<<<<<<") ? [index] : []));
}

/**
 * A laptop and a phone through their First syncs; then the other device
 * changes the first and last lines of `note.md` and syncs, and `finderName`
 * changes them differently and syncs, finding two text Conflict blocks.
 * Resolves with the finder and its note's text.
 */
async function textConflictOn(finderName: "laptop" | "phone") {
	const { dropbox, devices } = newDevices();
	const account = dropbox.addAccount("account-1");
	const laptop = await devices.start("Laptop vault", { files: { "note.md": BEFORE } });
	const phone = await devices.start("Phone vault", { phone: true });
	await devices.connectBoth(laptop, phone, account);
	const [finder, other] = finderName === "laptop" ? [laptop, phone] : [phone, laptop];
	const theirs = `first, theirs\n${MIDDLE}last, theirs\n`;
	await other.app.vault.process(fileOn(other, "note.md"), () => theirs);
	other.runCommand("sync-now");
	await vi.waitFor(() => expect(remoteText(account, "Laptop vault", "note.md")).toBe(theirs), PLUGIN_WAIT);
	await devices.settle();
	await finder.app.vault.process(fileOn(finder, "note.md"), () => `first, mine\n${MIDDLE}last, mine\n`);
	finder.runCommand("sync-now");
	await vi.waitFor(() => expect(finder.status()).toContain(fill(strings.conflictsCount, { count: "1" })), PLUGIN_WAIT);
	const text = await textOn(finder, "note.md");
	if (text === null) throw new Error("no note");
	return { finder, text };
}

/** A CodeMirror 6 editor in `device`'s element holding `text`, with the editor extensions the plugin registered; destroyed after the test. */
function editorOn(device: PluginDevice, text: string): EditorView {
	const view = new EditorView({ doc: text, extensions: device.plugin.editorExtensions as Extension[], parent: device.root });
	onTestFinished(() => view.destroy());
	return view;
}

/** The action rows the editor `view` shows, top to bottom. */
function actionRows(view: EditorView): HTMLElement[] {
	return [...view.dom.querySelectorAll<HTMLElement>(".seamsync-conflict-actions")];
}

/** The text of a Reading view panel showing a block's two sides, labelled. */
function panelText(local: string, localLabel: string, remote: string): string {
	return `${strings.conflictUnresolved}${strings.conflictUnresolvedHint}${localLabel}${local}Remote${remote}`;
}

/** The Reading view of the laptop's note: both panels with the middle between them. */
const READING_VIEW =
	panelText("first, mine\n", "Laptop vault", "first, theirs\n") + MIDDLE + panelText("last, mine\n", "Laptop vault", "last, theirs\n");

/**
 * Runs `device`'s Markdown post processor on the sections of the note
 * `text` from line `lineStart` to line `lineEnd` each, every one first
 * rendered as Obsidian's fake renders it, its own lines as text. Resolves
 * with the sections' elements and contexts.
 */
async function readingView(device: PluginDevice, text: string, sections: readonly (readonly [number, number])[]) {
	const [processor] = device.plugin.postProcessors as ((el: HTMLElement, ctx: PostProcessorContext) => Promise<void>)[];
	if (processor === undefined) throw new Error("no post processor");
	const lines = text.split("\n");
	const rendered: { readonly el: HTMLElement; readonly context: PostProcessorContext }[] = [];
	for (const [lineStart, lineEnd] of sections) {
		const el = device.root.createDiv({ text: lines.slice(lineStart, lineEnd + 1).join("\n") });
		const context = new device.obsidian.PostProcessorContext("note.md", { text, lineStart, lineEnd });
		await processor(el, context);
		rendered.push({ el, context });
	}
	return rendered;
}

describe("text Conflict blocks", { timeout: DEVICE_TEST_TIMEOUT_MS }, () => {
	it("are written by the sync between markers labelled with this device's name and the Remote", async () => {
		const { text } = await textConflictOn("laptop");

		expect(text).toBe(firstBlock("Laptop vault") + MIDDLE + lastBlock("Laptop vault"));
	});

	it("show each marker line in the editor as a block of its own text, which is none of the editor's lines", async () => {
		const { finder: laptop, text } = await textConflictOn("laptop");
		const view = editorOn(laptop, text);
		// The cursor between the blocks: a marker line it were on would be the editor's line, shown as typed.
		view.dispatch({ selection: { anchor: text.indexOf(MIDDLE) } });

		const markers = [...view.contentDOM.querySelectorAll<HTMLElement>(":scope > .seamsync-conflict-marker")];
		expect(markers.map((marker) => marker.textContent)).toEqual(text.split("\n").filter((line) => /^(<{7}|={7}|>{7})/.test(line)));
		expect(markers.filter((marker) => marker.classList.contains("cm-line"))).toEqual([]);
	});

	it("put the cursor on a marker line pressed in the editor, a cursor and no selection, and show the line as typed", async () => {
		const { finder: laptop, text } = await textConflictOn("laptop");
		const view = editorOn(laptop, text);
		view.dispatch({ selection: { anchor: text.indexOf(MIDDLE) } });
		const remoteMarker = text.split("\n").indexOf(">>>>>>> Remote");
		const pressed = [...view.contentDOM.querySelectorAll<HTMLElement>(":scope > .seamsync-conflict-marker")].find(
			(marker) => marker.textContent === ">>>>>>> Remote",
		);
		if (pressed === undefined) throw new Error("no >>>>>>> block");

		const press = new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 });
		pressed.dispatchEvent(press);

		// jsdom lays nothing out, so the press finds no character: the cursor goes to the line's start.
		const { main } = view.state.selection;
		expect(press.defaultPrevented).toBe(true);
		expect([main.anchor, main.head]).toEqual([view.state.doc.line(remoteMarker + 1).from, view.state.doc.line(remoteMarker + 1).from]);
		const line = [...view.contentDOM.querySelectorAll<HTMLElement>(":scope > .cm-line")].find(
			(element) => element.textContent === ">>>>>>> Remote",
		);
		expect(line?.classList).toContain("seamsync-conflict-marker");
	});

	it("are resolved by each button of a block's action row in the editor", async () => {
		const { finder: laptop, text } = await textConflictOn("laptop");
		const keepLaptop = fill(strings.conflictKeep, { label: "Laptop vault" });
		const keepRemote = fill(strings.conflictKeep, { label: "Remote" });
		const resolved: Record<string, string> = {};

		for (const label of [keepLaptop, keepRemote, strings.conflictKeepBoth]) {
			const view = editorOn(laptop, text);
			const [first, ...others] = actionRows(view);
			if (first === undefined) throw new Error("no action row");
			expect(others).toHaveLength(1);
			expect(first.classList).not.toContain("seamsync-phone");
			buttonIn(first, label).click();
			resolved[label] = view.state.doc.toString();
			expect(actionRows(view)).toHaveLength(1);
		}

		const rest = MIDDLE + lastBlock("Laptop vault");
		expect(resolved).toEqual({
			[keepLaptop]: `first, mine\n${rest}`,
			[keepRemote]: `first, theirs\n${rest}`,
			[strings.conflictKeepBoth]: `first, mine\nfirst, theirs\n${rest}`,
		});
	});

	it("are combined by hand in the Edit… dialog, on a phone fitted for it", async () => {
		const { finder: phone, text } = await textConflictOn("phone");
		const view = editorOn(phone, text);
		const [first] = actionRows(view);
		if (first === undefined) throw new Error("no action row");
		expect(first.classList).toContain("seamsync-phone");

		buttonIn(first, strings.conflictEdit).click();
		const [dialog, ...others] = phone.windowsOpened(strings.conflictEditTitle);
		if (dialog === undefined) throw new Error("no Edit… dialog");
		expect(others).toEqual([]);
		expect(dialog.modalEl.classList).toContain("seamsync-phone");
		const sides = [...dialog.contentEl.querySelectorAll(".seamsync-conflict-edit-side")].map((side) => side.textContent);
		expect(sides).toEqual(["Phone vaultfirst, mine\n", "Remotefirst, theirs\n"]);
		const field = dialog.contentEl.querySelector("textarea");
		if (field === null) throw new Error("no text field");
		expect(field.value).toBe("first, mine\nfirst, theirs\n");
		field.value = "first, both combined\n";
		field.dispatchEvent(new Event("input"));
		buttonIn(dialog.contentEl, strings.save).click();

		expect(view.state.doc.toString()).toBe(`first, both combined\n${MIDDLE}${lastBlock("Phone vault")}`);
		expect(dialog.modalEl.isConnected).toBe(false);
	});

	it("are reached by Next conflict and Previous conflict, wrapping around; a note without one says so", async () => {
		const { finder: laptop, text } = await textConflictOn("laptop");
		const [first, second] = blockStarts(text);
		const middle = text.split("\n").indexOf("middle two");
		const view = await laptop.app.workspace.openInEditor(fileOn(laptop, "note.md"));
		/** Where `command` puts the cursor from the start of `line`. */
		const from = (line: number, command: string) => {
			view.editor.setCursor(line);
			laptop.runCommand(command, view);
			return view.editor.getCursor();
		};

		expect([first, second]).toEqual([0, 8]);
		expect(from(middle, "previous-conflict")).toEqual({ line: first, ch: 0 });
		expect(from(middle, "next-conflict")).toEqual({ line: second, ch: 0 });
		expect(from(second ?? -1, "next-conflict")).toEqual({ line: first, ch: 0 });
		expect(from(first ?? -1, "previous-conflict")).toEqual({ line: second, ch: 0 });
		await laptop.app.vault.createBinary("plain.md", new TextEncoder().encode("nothing to resolve\n").buffer);
		const plain = await laptop.app.workspace.openInEditor(fileOn(laptop, "plain.md"));
		laptop.runCommand("next-conflict", plain);

		expect(laptop.notices()).toContain(strings.noConflicts);
		expect(plain.editor.getCursor()).toEqual({ line: 0, ch: 0 });
	});

	it("show in the Reading view as panels with both sides and none of their markers, the note as one section", async () => {
		const { finder: laptop, text } = await textConflictOn("laptop");

		const [whole] = await readingView(laptop, text, [[0, 12]]);

		expect(whole?.el.textContent).toBe(READING_VIEW);
		expect(whole?.context.children).toHaveLength(1);
	});

	it("show in the Reading view the same when a block spans sections: the panel where it starts, nothing for its later lines", async () => {
		const { finder: laptop, text } = await textConflictOn("laptop");

		// The first block split after its `=======` line.
		const sections = await readingView(laptop, text, [
			[0, 2],
			[3, 4],
			[5, 7],
			[8, 12],
		]);

		expect(sections.map(({ el }) => el.textContent)).toEqual([
			panelText("first, mine\n", "Laptop vault", "first, theirs\n"),
			"",
			// No block touches the middle: it stays as Obsidian rendered it.
			"middle one\nmiddle two\nmiddle three",
			panelText("last, mine\n", "Laptop vault", "last, theirs\n"),
		]);
		expect(sections.map(({ context }) => context.children.length)).toEqual([1, 1, 0, 1]);
	});

	it("leave a section as Obsidian rendered it when it gives no section information", async () => {
		const { finder: laptop } = await textConflictOn("laptop");
		const [processor] = laptop.plugin.postProcessors as ((el: HTMLElement, ctx: PostProcessorContext) => Promise<void>)[];
		if (processor === undefined) throw new Error("no post processor");
		const el = laptop.root.createDiv({ text: "as Obsidian rendered it" });
		const context = new laptop.obsidian.PostProcessorContext("note.md", null);

		await processor(el, context);

		expect(el.textContent).toBe("as Obsidian rendered it");
		expect(context.children).toEqual([]);
	});
});
