// @vitest-environment jsdom
// Manual check 6 through the whole plugin: the network coming back and
// Obsidian becoming visible each start a sync, which brings the other
// device's change. The devices share the window and the document, so each
// event reaches the laptop too, whose sync then finds nothing to do.
import "fake-indexeddb/auto";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import type { FakeDropboxAccount } from "../fakes/fake-dropbox";
import { fileOn, remoteText, textOn, useDevices } from "../support/plugin-devices";
import { PLUGIN_WAIT } from "../support/plugin-run";
import { DEVICE_TEST_TIMEOUT_MS } from "../support/timeouts";

const newDevices = useDevices();

/** The text the fake Dropbox holds for `path` in the laptop's Remote, or null when it holds none. */
function textOnRemote(account: FakeDropboxAccount, path: string): string | null {
	return remoteText(account, "Laptop vault", path);
}

/**
 * A laptop and a phone both holding `note.md` as "hello" after their First
 * syncs; then the laptop changes it and syncs, so only the phone's next
 * sync brings the change. Polling (every 60 s by default) does not come
 * within a test, so the phone syncs only when something starts it.
 */
async function changedOnLaptop() {
	const { dropbox, devices } = newDevices();
	const account = dropbox.addAccount("account-1");
	const laptop = await devices.start("Laptop vault", { files: { "note.md": "hello" } });
	const phone = await devices.start("Phone vault", { phone: true });
	await devices.connectBoth(laptop, phone, account);
	await laptop.app.vault.process(fileOn(laptop, "note.md"), () => "changed on the laptop");
	laptop.runCommand("sync-now");
	await vi.waitFor(() => expect(textOnRemote(account, "note.md")).toBe("changed on the laptop"), PLUGIN_WAIT);
	expect(await textOn(phone, "note.md")).toBe("hello");
	return { devices, phone };
}

describe("what starts a sync on its own", { timeout: DEVICE_TEST_TIMEOUT_MS }, () => {
	it("syncs when the network comes back", async () => {
		const { phone } = await changedOnLaptop();

		window.dispatchEvent(new Event("online"));

		await vi.waitFor(async () => expect(await textOn(phone, "note.md")).toBe("changed on the laptop"), PLUGIN_WAIT);
	});

	it("syncs when Obsidian becomes visible, not when it is hidden", async () => {
		const { devices, phone } = await changedOnLaptop();
		const visibility = vi.spyOn(document, "visibilityState", "get");
		onTestFinished(() => visibility.mockRestore());

		const sentBefore = phone.requestCount();

		visibility.mockReturnValue("hidden");
		document.dispatchEvent(new Event("visibilitychange"));
		// A sync it started would have sent its first request by now, long before bringing the change.
		await new Promise((resolve) => window.setTimeout(resolve, 300));
		await devices.settle();
		expect(phone.requestCount()).toBe(sentBefore);
		expect(await textOn(phone, "note.md")).toBe("hello");
		visibility.mockReturnValue("visible");
		document.dispatchEvent(new Event("visibilitychange"));

		await vi.waitFor(async () => expect(await textOn(phone, "note.md")).toBe("changed on the laptop"), PLUGIN_WAIT);
	});
});
