// @vitest-environment jsdom
// Manual check 11 through the whole plugin: deleting more files than the
// Deletion guard allows opens its window, which lists them for review;
// Apply deletes them on the Remote, Restore brings them back, and closing
// the window holds sync until the user syncs.
import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import { fill } from "../../src/ui/i18n/fill";
import { selectStrings } from "../../src/ui/i18n/strings";
import type { FakeDropboxAccount } from "../fakes/fake-dropbox";
import type { Modal } from "../fakes/obsidian";
import { fileOn, filesOn, remoteBytes, textOn, useDevices, type PluginDevice } from "../support/plugin-devices";
import { PLUGIN_WAIT, buttonIn } from "../support/plugin-run";
import { DEVICE_TEST_TIMEOUT_MS } from "../support/timeouts";

const strings = selectStrings("en");

const newDevices = useDevices();

/** The vault's name, which its Remote folder is named after. */
const VAULT = "Test vault";

/** Ten notes, `note-1.md` to `note-10.md`. */
const NOTES = Object.fromEntries(Array.from({ length: 10 }, (_, index) => [`note-${index + 1}.md`, `note ${index + 1}`]));

/** The six notes deleted: more than half of the vault, over the guard's default 50 %. */
const DELETED = Object.keys(NOTES).slice(0, 6).sort();

/** The four notes not deleted. */
const KEPT = Object.keys(NOTES).slice(6).sort();

/**
 * A device holding `NOTES`, connected through its First sync, that deletes
 * `DELETED` and syncs; resolves with it and its account once its first
 * Deletion guard window is open.
 */
async function deletedMany(options: { phone?: boolean } = {}) {
	const { dropbox, devices } = newDevices();
	const account = dropbox.addAccount("account-1");
	const device = await devices.start(VAULT, { ...options, files: NOTES });
	await devices.connect(device, account);
	await devices.startFirstSync(device);
	for (const path of DELETED) await device.app.fileManager.trashFile(fileOn(device, path));
	device.runCommand("sync-now");
	await vi.waitFor(() => expect(guards(device)).toHaveLength(1), PLUGIN_WAIT);
	return { devices, account, device };
}

/** The Deletion guard windows `device` opened, oldest first. */
function guards(device: PluginDevice): Modal[] {
	return device.windowsOpened(strings.guardTitle);
}

/** The Deletion guard window `device` opened last; fails when it opened none. */
function lastGuard(device: PluginDevice): Modal {
	const all = guards(device);
	const last = all[all.length - 1];
	if (last === undefined) throw new Error("no Deletion guard window");
	return last;
}

/** The paths of `NOTES` that `account` holds in the vault's Remote folder, sorted. */
function notesOnRemote(account: FakeDropboxAccount): string[] {
	return Object.keys(NOTES)
		.filter((path) => remoteBytes(account, VAULT, path) !== null)
		.sort();
}

/** The status of `device` once it no longer says it is syncing. */
async function settledStatus(device: PluginDevice): Promise<string> {
	await vi.waitFor(() => expect(device.status()).not.toContain(strings.statusSyncing), PLUGIN_WAIT);
	return device.status();
}

describe("the Deletion guard window", { timeout: DEVICE_TEST_TIMEOUT_MS }, () => {
	it("opens on deleting more files than the guard allows, lists them for review, and applies them", async () => {
		const { account, device } = await deletedMany();
		const guard = lastGuard(device);
		const paragraphs = [...guard.contentEl.querySelectorAll("p")].map((paragraph) => paragraph.textContent);

		expect(paragraphs).toEqual([strings.guardReasonThreshold, fill(strings.guardToRemote, { count: "6" }), strings.guardCloseHint]);
		const list = guard.contentEl.querySelector<HTMLElement>(".seamsync-guard-list");
		expect(list?.isShown()).toBe(false);
		buttonIn(guard.contentEl, strings.guardReview).click();
		expect(list?.isShown()).toBe(true);
		expect([...(list?.querySelectorAll("li") ?? [])].map((item) => item.textContent).sort()).toEqual(DELETED);
		expect(buttonIn(guard.contentEl, strings.guardHideList)).toBeInstanceOf(HTMLButtonElement);
		buttonIn(guard.contentEl, strings.guardApply).click();

		await vi.waitFor(() => expect(notesOnRemote(account)).toEqual(KEPT), PLUGIN_WAIT);
		expect(guard.modalEl.isConnected).toBe(false);
		expect(await settledStatus(device)).toContain(strings.statusSynced);
		expect(filesOn(device)).toEqual(KEPT);
	});

	it("restores the deleted files on Restore, its window fitted for a phone on a phone", async () => {
		const { account, device } = await deletedMany({ phone: true });
		const guard = lastGuard(device);

		expect(guard.modalEl.classList).toContain("seamsync-phone");
		buttonIn(guard.contentEl, strings.guardRestore).click();

		await vi.waitFor(() => expect(filesOn(device)).toEqual(Object.keys(NOTES).sort()), PLUGIN_WAIT);
		for (const path of DELETED) expect(await textOn(device, path)).toBe(NOTES[path]);
		expect(notesOnRemote(account)).toEqual(Object.keys(NOTES).sort());
		expect(await settledStatus(device)).toContain(strings.statusSynced);
	});

	it("holds sync when closed without a choice, which only the user's sync lifts", async () => {
		const { devices, account, device } = await deletedMany();
		const item = device.plugin.statusBarItems[0];
		if (item === undefined) throw new Error("no status bar item");

		lastGuard(device).close();
		await vi.waitFor(() => expect(device.status()).toContain(strings.statusDeletionsOnHold), PLUGIN_WAIT);
		// The automatic sync the network starts shows the hold again, even unchanged: it reached the held device.
		const shownAgain: MutationRecord[] = [];
		const observer = new MutationObserver((records) => shownAgain.push(...records));
		observer.observe(item, { subtree: true, childList: true, characterData: true, attributes: true });
		window.dispatchEvent(new Event("online"));
		await vi.waitFor(() => expect(shownAgain.length).toBeGreaterThan(0), PLUGIN_WAIT);
		observer.disconnect();
		await devices.settle();
		expect(guards(device)).toHaveLength(1);
		expect(device.status()).toContain(strings.statusDeletionsOnHold);
		expect(notesOnRemote(account)).toEqual(Object.keys(NOTES).sort());
		device.runCommand("sync-now");

		// The second window stays open; unloading the plugin closes it.
		await vi.waitFor(() => expect(guards(device)).toHaveLength(2), PLUGIN_WAIT);
	});
});
