// @vitest-environment jsdom
// Manual check 10 through the whole plugin: a folder renamed on one device
// is renamed on the Remote and on the other device, and nothing of it goes
// to the trash on either. The fake vault tells a folder's rename as
// Obsidian does, seen in the desktop run: one `rename` event for the
// folder, then one for each folder and file inside it.
import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import { filesOn, remoteBytes, textOn, useDevices, type PluginDevice } from "../support/plugin-devices";
import { PLUGIN_WAIT } from "../support/plugin-run";
import { DEVICE_TEST_TIMEOUT_MS } from "../support/timeouts";

const newDevices = useDevices();

/** The text of every note in the folder. */
const SAME_TEXT = "the same note";

/**
 * The notes of the folder before it is renamed, by path under it. They
 * hold the same text, so no rename is found by content: only the vault's
 * rename, and on the other device the Remote's, tell where each went.
 */
const NOTES = { "a.md": SAME_TEXT, "b.md": SAME_TEXT, "sub/c.md": SAME_TEXT };

/**
 * Notes outside the folder, so its notes are under half of the vault: a
 * rename taken for deletions would then pass the Deletion guard and reach
 * the trash, rather than stop at the guard.
 */
const OTHERS = Object.fromEntries(Array.from({ length: 7 }, (_, index) => [`other-${index + 1}.md`, `other ${index + 1}`]));

/** Every way `device`'s vault moves something to the trash: Obsidian's own, and the adapter's for hidden paths. */
function trashOf(device: PluginDevice) {
	return [
		vi.spyOn(device.app.fileManager, "trashFile"),
		vi.spyOn(device.app.vault.adapter, "trashSystem"),
		vi.spyOn(device.app.vault.adapter, "trashLocal"),
	];
}

describe("a folder renamed on one device", { timeout: DEVICE_TEST_TIMEOUT_MS }, () => {
	it("is renamed on the Remote and on the other device, with nothing trashed", async () => {
		const { dropbox, devices } = newDevices();
		const account = dropbox.addAccount("account-1");
		const files = { ...OTHERS, ...Object.fromEntries(Object.entries(NOTES).map(([path, text]) => [`notes/${path}`, text])) };
		const laptop = await devices.start("Laptop vault", { files });
		const phone = await devices.start("Phone vault", { phone: true });
		await devices.connectBoth(laptop, phone, account);
		const trashed = [...trashOf(laptop), ...trashOf(phone)];
		const folder = laptop.app.vault.getAbstractFileByPath("notes");
		if (folder === null) throw new Error("no folder notes");
		const afterRename = [...Object.keys(NOTES).map((path) => `archive/${path}`), ...Object.keys(OTHERS)].sort();

		await laptop.app.vault.rename(folder, "archive");
		laptop.runCommand("sync-now");
		await vi.waitFor(() => {
			for (const path of Object.keys(NOTES)) {
				expect(remoteBytes(account, "Laptop vault", `archive/${path}`)).not.toBeNull();
				expect(remoteBytes(account, "Laptop vault", `notes/${path}`)).toBeNull();
			}
		}, PLUGIN_WAIT);
		phone.runCommand("sync-now");

		await vi.waitFor(() => expect(filesOn(phone)).toEqual(afterRename), PLUGIN_WAIT);
		for (const [path, text] of Object.entries(NOTES)) expect(await textOn(phone, `archive/${path}`)).toBe(text);
		expect(filesOn(laptop)).toEqual(afterRename);
		// No empty folder is left behind at the old name.
		expect(phone.app.vault.getAbstractFileByPath("notes")).toBeNull();
		expect(account.get("/Laptop vault/notes")).toBeUndefined();
		for (const trash of trashed) expect(trash).not.toHaveBeenCalled();
	});
});
