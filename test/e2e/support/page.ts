// What the desktop and Android runs share about Obsidian's page: the eval
// helpers the scenarios put at the start of a body, and the scenarios both
// runs check the same way.
import { describe, expect, it } from "vitest";
import type { Strings } from "../../../src/ui/i18n/strings";

/** How long one evaluation on the desktop or the phone may take, unless a scenario gives its own: the scenarios' own waits stay well under it. */
export const CALL_MS = 60_000;
/** Headroom of a test over the evaluations and device calls in it, so the page's own timeout message is the one shown. */
export const TEST_HEADROOM_MS = 120_000;

/** An Obsidian a run drives: the desktop's through its CLI, the emulator's through DevTools. */
export interface ObsidianPage {
	/** The value `body`, the body of an async function (see `evalProgram`), returns in Obsidian's page. */
	eval(body: string): Promise<unknown>;
	/** The plugin's strings in Obsidian's language. */
	strings(): Promise<Strings>;
}

/**
 * Eval helpers for the scenarios, to put at the start of a body:
 *
 * - `button(text, root = activeDocument)` waits for a button with that text
 *   in an open window (or in `root`);
 * - `openSyncWindow()` runs the plugin's Open sync window command and
 *   resolves with the window;
 * - `buttons(root)` lists a root's buttons with their heights, in layout
 *   pixels (`offsetHeight`): the box's own height is snapped to device
 *   pixels, so 44 px can read 43.99 at a fractional device pixel ratio;
 * - `closeModals()` closes every open window with Escape, as a user does,
 *   one window per key press.
 */
export const PAGE_HELPERS = `
	const button = (text, root) => until(
		() => [...(root ?? activeDocument).querySelectorAll(root ? "button" : ".modal button")].find((b) => b.textContent === text),
		10000,
		"the " + text + " button",
	);
	const openSyncWindow = () => {
		app.commands.executeCommandById("obsync:open-sync-window");
		return until(() => activeDocument.querySelector(".modal.obsync-sync-window"), 10000, "the Sync window");
	};
	const buttons = (root) => [...root.querySelectorAll("button")].map((b) => ({ text: b.textContent, height: b.offsetHeight }));
	const closeModals = () => until(() => {
		if (activeDocument.querySelectorAll(".modal").length === 0) return true;
		activeDocument.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));
		return false;
	}, 10000, "the windows to close");`;

/** A window's or row's buttons, as `buttons(root)` lists them, and whether it carries `obsync-phone`. */
export interface ButtonsFound {
	readonly phone: boolean;
	readonly buttons: readonly { readonly text: string; readonly height: number }[];
}

/** The minimum height of a button on a phone (spec, check 14). */
export const MIN_BUTTON_PX = 44;

/** Expects `found` to be a phone window with buttons, none below MIN_BUTTON_PX. */
export function expectPhoneButtons(found: ButtonsFound): void {
	expect(found.phone).toBe(true);
	expect(found.buttons.length).toBeGreaterThan(0);
	expect(found.buttons.filter((button) => button.height < MIN_BUTTON_PX)).toEqual([]);
}

/**
 * Check 14 for what opens without a Dropbox login: the Sync window, the
 * connect window, a conflict block's action row and its Edit… dialog, on
 * `page`, which is a phone. `title` names the check for the run's summary.
 */
export function describePhoneButtons(title: string, page: () => ObsidianPage): void {
	describe(title, () => {
		it("in the Sync window and the connect window", async () => {
			const strings = await page().strings();
			const found = (await page().eval(`
				${PAGE_HELPERS}
				const sync = await openSyncWindow();
				const syncButtons = buttons(sync);
				(await button(${JSON.stringify(strings.connect)}, sync)).click();
				const connect = await until(() => [...activeDocument.querySelectorAll(".modal")].find((m) => m !== sync && m.querySelector("input")), 10000, "the connect window");
				const result = { sync: { phone: sync.classList.contains("obsync-phone"), buttons: syncButtons }, connect: { phone: connect.classList.contains("obsync-phone"), buttons: buttons(connect) } };
				await closeModals();
				return result;`)) as Record<"sync" | "connect", ButtonsFound>;
			expectPhoneButtons(found.sync);
			expectPhoneButtons(found.connect);
		});

		it("in a conflict block's action row and its Edit… dialog", async () => {
			const strings = await page().strings();
			const note = ["<<<<<<< Phone vault", "mine", "=======", "theirs", ">>>>>>> Remote", ""].join("\n");
			const found = (await page().eval(`
				${PAGE_HELPERS}
				const file = await app.vault.create("phone-conflict.md", ${JSON.stringify(note)});
				const leaf = app.workspace.getLeaf(true);
				await leaf.setViewState({ type: "markdown", state: { file: file.path, mode: "source", source: false } });
				const row = await until(() => leaf.view.contentEl.querySelector(".obsync-conflict-actions"), 10000, "the action row");
				const rowButtons = buttons(row);
				(await button(${JSON.stringify(strings.conflictEdit)}, row)).click();
				const dialog = await until(() => activeDocument.querySelector(".modal.obsync-conflict-edit"), 10000, "the Edit dialog");
				const result = { row: { phone: row.classList.contains("obsync-phone"), buttons: rowButtons }, dialog: { phone: dialog.classList.contains("obsync-phone"), buttons: buttons(dialog) } };
				await closeModals();
				leaf.detach();
				await app.vault.delete(file);
				return result;`)) as Record<"row" | "dialog", ButtonsFound>;
			expectPhoneButtons(found.row);
			expectPhoneButtons(found.dialog);
		});
	});
}
