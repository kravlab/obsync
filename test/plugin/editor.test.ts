// @vitest-environment jsdom
// Manual check 7 through the whole plugin: a note open in an editor,
// changed on the other device, is updated in place, and the cursor keeps
// its place in the text around it.
import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import type { EditorPosition } from "../fakes/obsidian";
import { fileOn, remoteText, textOn, useDevices } from "../support/plugin-devices";
import { PLUGIN_WAIT } from "../support/plugin-run";
import { DEVICE_TEST_TIMEOUT_MS } from "../support/timeouts";

const newDevices = useDevices();

/** The note on both devices before the change. */
const BEFORE = "first line\nsecond line\nthird line\n";

/**
 * A laptop and a phone both holding `note.md` as `BEFORE`, the phone with
 * it open in an editor and the cursor at `cursor`; then the laptop changes
 * it to `after` and the phone syncs. Resolves once the phone's editor holds
 * `after`, with the phone's editor.
 */
async function changedWhileOpen(cursor: EditorPosition, after: string) {
	const { dropbox, devices } = newDevices();
	const account = dropbox.addAccount("account-1");
	const laptop = await devices.start("Laptop vault", { files: { "note.md": BEFORE } });
	const phone = await devices.start("Phone vault", { phone: true });
	await devices.connectBoth(laptop, phone, account);
	const view = await phone.app.workspace.openInEditor(fileOn(phone, "note.md"));
	view.editor.setCursor(cursor);

	await laptop.app.vault.process(fileOn(laptop, "note.md"), () => after);
	laptop.runCommand("sync-now");
	await vi.waitFor(() => expect(remoteText(account, "Laptop vault", "note.md")).toBe(after), PLUGIN_WAIT);
	await devices.settle();
	phone.runCommand("sync-now");
	await vi.waitFor(() => expect(view.editor.getValue()).toBe(after), PLUGIN_WAIT);
	return { phone, editor: view.editor };
}

describe("a note open in an editor while it syncs", { timeout: DEVICE_TEST_TIMEOUT_MS }, () => {
	it("moves the cursor with its text when the change comes before it, and saves the note", async () => {
		// A line added before the cursor's: its line number changes, its place in the text does not.
		const after = "the first line, changed on the laptop\nand a line added\nsecond line\nthird line\n";

		const { phone, editor } = await changedWhileOpen({ line: 2, ch: 5 }, after);

		expect(editor.getCursor()).toEqual({ line: 3, ch: 5 });
		await vi.waitFor(async () => expect(await textOn(phone, "note.md")).toBe(after), PLUGIN_WAIT);
	});

	it("leaves the cursor where it is when the change comes after it, and saves the note", async () => {
		const after = "first line\nsecond line\nthe third line, changed\nand a fourth\n";

		const { phone, editor } = await changedWhileOpen({ line: 0, ch: 5 }, after);

		expect(editor.getCursor()).toEqual({ line: 0, ch: 5 });
		await vi.waitFor(async () => expect(await textOn(phone, "note.md")).toBe(after), PLUGIN_WAIT);
	});
});
