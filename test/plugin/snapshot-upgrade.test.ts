// @vitest-environment jsdom
// Manual check 18 through the whole plugin: a vault synced by the build
// before First sync holds a schema 3 snapshot database and that build's
// Connection; after the update that database opens as a complete
// snapshot, so the next sync runs as usual, with no First sync preview,
// and notes in the Connection that the First sync is done.
import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import { selectStrings } from "../../src/ui/i18n/strings";
import { fileOn, filesOn, remoteText, useDevices } from "../support/plugin-devices";
import { PLUGIN_WAIT } from "../support/plugin-run";
import { downgradeToSchema3 } from "../support/schema-3-snapshot";
import { DEVICE_TEST_TIMEOUT_MS } from "../support/timeouts";

const strings = selectStrings("en");

const newDevices = useDevices();

describe("a snapshot database from the build before First sync", { timeout: DEVICE_TEST_TIMEOUT_MS }, () => {
	it("opens as a complete snapshot: the next sync runs, with no First sync preview", async () => {
		const { dropbox, devices } = newDevices();
		const account = dropbox.addAccount("account-1");
		const before = await devices.start("Laptop vault", { files: { "note.md": "hello" } });
		await devices.connect(before, account);
		await devices.startFirstSync(before);

		const laptop = await devices.restart(before, () => downgradeToSchema3(before.app));
		await laptop.app.vault.process(fileOn(laptop, "note.md"), () => "changed after the update");
		laptop.runCommand("sync-now");

		await vi.waitFor(() => expect(remoteText(account, "Laptop vault", "note.md")).toBe("changed after the update"), PLUGIN_WAIT);
		await vi.waitFor(() => expect(laptop.status()).toContain(strings.statusSynced), PLUGIN_WAIT);
		expect(laptop.windowsOpened(strings.firstSyncTitle)).toEqual([]);
		// The old snapshot was read: the note was known on both sides, so no Conflict copy.
		expect(filesOn(laptop)).toEqual(["note.md"]);
		const stored = laptop.app.loadLocalStorage("seamsync-connection") as { connection?: { firstSyncDone?: unknown } } | null;
		expect(stored?.connection?.firstSyncDone).toBe(true);
	});
});
