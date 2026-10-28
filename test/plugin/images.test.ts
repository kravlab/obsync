// @vitest-environment jsdom
// Manual check 9: images between two devices, through the whole plugin
// (vault, Dropbox provider, fake Dropbox), and a binary conflict.
import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import { isConflictCopy } from "../../src/engine/conflict-copy";
import { fill } from "../../src/ui/i18n/fill";
import { selectStrings } from "../../src/ui/i18n/strings";
import type { FakeDropboxAccount } from "../fakes/fake-dropbox";
import { bytesOn, fileOn, remoteBytes, useDevices, type PluginDevice } from "../support/plugin-devices";
import { PLUGIN_WAIT } from "../support/plugin-run";
import { DEVICE_TEST_TIMEOUT_MS } from "../support/timeouts";

const strings = selectStrings("en");

const newDevices = useDevices();

/** The bytes of an image: a PNG signature, bytes no UTF-8 text holds, then `last`. */
function image(last: number): number[] {
	return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xfe, 0x00, 0x80, last];
}

/** `bytes` in a fresh ArrayBuffer, as a vault file holds them. */
function buffer(bytes: number[]): ArrayBuffer {
	return new Uint8Array(bytes).buffer;
}

/** The bytes the fake Dropbox holds for `path` in the laptop's Remote, or null when it holds none. */
function onRemote(account: FakeDropboxAccount, path: string): number[] | null {
	return remoteBytes(account, "Laptop vault", path);
}

/**
 * A laptop whose vault holds `photo.png` and a phone with an empty vault,
 * both connected to the laptop's Remote and through their First sync.
 */
async function bothSynced() {
	const { dropbox, devices } = newDevices();
	const account = dropbox.addAccount("account-1");
	const laptop = await devices.start("Laptop vault", { files: { "photo.png": buffer(image(1)) } });
	const phone = await devices.start("Phone vault", { phone: true });
	await devices.connectBoth(laptop, phone, account);
	return { account, laptop, phone };
}

/** The Conflict copies in `device`'s vault. */
function conflictCopies(device: PluginDevice): string[] {
	return device.app.vault
		.getAllLoadedFiles()
		.map((file) => file.path)
		.filter((path) => isConflictCopy(path));
}

describe("images between two devices", { timeout: DEVICE_TEST_TIMEOUT_MS }, () => {
	it("brings an image from the first device's vault to the second one byte for byte", async () => {
		const { phone } = await bothSynced();

		expect(await bytesOn(phone, "photo.png")).toEqual(image(1));
	});

	it("brings an image added later on the second device to the first one", async () => {
		const { account, laptop, phone } = await bothSynced();

		await phone.app.vault.createBinary("images/from-phone.png", buffer(image(2)));
		phone.runCommand("sync-now");
		await vi.waitFor(() => expect(onRemote(account, "images/from-phone.png")).toEqual(image(2)), PLUGIN_WAIT);
		laptop.runCommand("sync-now");

		await vi.waitFor(async () => expect(await bytesOn(laptop, "images/from-phone.png")).toEqual(image(2)), PLUGIN_WAIT);
	});

	it("brings an image added later on the first device to the second one", async () => {
		const { account, laptop, phone } = await bothSynced();

		await laptop.app.vault.createBinary("images/from-laptop.png", buffer(image(3)));
		laptop.runCommand("sync-now");
		await vi.waitFor(() => expect(onRemote(account, "images/from-laptop.png")).toEqual(image(3)), PLUGIN_WAIT);
		phone.runCommand("sync-now");

		await vi.waitFor(async () => expect(await bytesOn(phone, "images/from-laptop.png")).toEqual(image(3)), PLUGIN_WAIT);
	});

	it("keeps both versions of an image changed on both devices: a Conflict copy, its notice and a Conflicts entry", async () => {
		const { account, laptop, phone } = await bothSynced();

		await phone.app.vault.modifyBinary(fileOn(phone, "photo.png"), buffer(image(4)));
		phone.runCommand("sync-now");
		// The laptop changes its version only once the phone's is on the Remote, so the laptop is the one to find the conflict.
		await vi.waitFor(() => expect(onRemote(account, "photo.png")).toEqual(image(4)), PLUGIN_WAIT);
		await laptop.app.vault.modifyBinary(fileOn(laptop, "photo.png"), buffer(image(5)));
		laptop.runCommand("sync-now");

		// The laptop's version is kept beside the phone's; the copy is written before the phone's version arrives.
		await vi.waitFor(async () => {
			expect(conflictCopies(laptop)).toHaveLength(1);
			expect(await bytesOn(laptop, "photo.png")).toEqual(image(4));
		}, PLUGIN_WAIT);
		const copy = conflictCopies(laptop)[0] ?? "";
		expect(await bytesOn(laptop, copy)).toEqual(image(5));
		expect(laptop.notices()).toContain(fill(strings.noticeConflictCopyCreated, { file: "photo.png", copy }));
		// The Conflicts list reaches the window after the sync's writes.
		laptop.runCommand("show-conflicts");
		await vi.waitFor(() => laptop.button(copy), PLUGIN_WAIT);
		expect(laptop.button(fill(strings.tabConflicts, { count: "1" }))).toBeInstanceOf(HTMLButtonElement);
	});
});
