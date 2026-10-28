// @vitest-environment jsdom
// Manual check 5: the First sync of a second device joining a Remote,
// through the whole plugin: the second device's preview and its counts,
// then the union of both vaults on both devices.
import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import { fill } from "../../src/ui/i18n/fill";
import { selectStrings } from "../../src/ui/i18n/strings";
import type { FakeDropboxAccount } from "../fakes/fake-dropbox";
import {
	filesOn,
	textOn,
	useDevices,
	type PluginDevice,
	type PluginDevices,
} from "../support/plugin-devices";
import { PLUGIN_WAIT, type ConnectChoice } from "../support/plugin-run";
import { DEVICE_TEST_TIMEOUT_MS } from "../support/timeouts";

const strings = selectStrings("en");

const newDevices = useDevices();

/** `count` notes named `prefix-1.md` to `prefix-<count>.md`, each holding `text` and its number. */
function notes(prefix: string, count: number, text: string): Record<string, string> {
	return Object.fromEntries(Array.from({ length: count }, (_, index) => [`${prefix}-${index + 1}.md`, `${text} ${index + 1}\n`]));
}

/** The laptop's vault: 1 note of its own, 3 the phone holds the same, 4 the phone holds differently. */
const LAPTOP_FILES = { "laptop.md": "from the laptop\n", ...notes("same", 3, "the same on both"), ...notes("differs", 4, "the laptop's line") };

/** The phone's vault: 2 notes of its own, then the laptop's 3 the same and 4 differently, so each preview count is its own. */
const PHONE_FILES = { ...notes("phone", 2, "from the phone"), ...notes("same", 3, "the same on both"), ...notes("differs", 4, "the phone's line") };

/** The count lines a First sync preview shows for what it would do. */
function previewLines(counts: { download: number; upload: number; identical: number; differing: number }): string[] {
	return [
		fill(strings.firstSyncToDownload, { count: String(counts.download) }),
		fill(strings.firstSyncToUpload, { count: String(counts.upload) }),
		fill(strings.firstSyncIdentical, { count: String(counts.identical) }),
		fill(strings.firstSyncDiffering, { count: String(counts.differing) }),
	];
}

/** The texts of the paragraphs in `device`'s windows, each whole, the open First sync preview's lines among them. */
function paragraphsOn(device: PluginDevice): string[] {
	return [...device.root.querySelectorAll("p")].map((paragraph) => paragraph.textContent);
}

/**
 * Connects `device` as `account` approves, to the Remote `choice` names,
 * hands the paragraphs of its First sync preview to `look` once it is open,
 * then starts the First sync and waits for it to end.
 */
async function throughFirstSync(
	devices: PluginDevices,
	device: PluginDevice,
	account: FakeDropboxAccount,
	choice: ConnectChoice = {},
	look: (paragraphs: string[]) => void = () => undefined,
): Promise<void> {
	await devices.connect(device, account, choice);
	// The Start button is drawn last, so once it is there the whole preview is.
	await vi.waitFor(() => device.button(strings.firstSyncStart), PLUGIN_WAIT);
	look(paragraphsOn(device));
	await devices.startFirstSync(device);
}

/** A laptop and a phone with the vaults above, on one fake Dropbox account. */
async function laptopAndPhone() {
	const { dropbox, devices } = newDevices();
	const account = dropbox.addAccount("account-1");
	const laptop = await devices.start("Laptop vault", { files: LAPTOP_FILES });
	const phone = await devices.start("Phone vault", { phone: true, files: PHONE_FILES });
	return { devices, account, laptop, phone };
}

describe("the First sync of a second device", { timeout: DEVICE_TEST_TIMEOUT_MS }, () => {
	it("previews on each device what its First sync does, each count in its own line", async () => {
		const { devices, account, laptop, phone } = await laptopAndPhone();

		await throughFirstSync(devices, laptop, account, {}, (paragraphs) =>
			expect(paragraphs).toEqual(expect.arrayContaining(previewLines({ download: 0, upload: 8, identical: 0, differing: 0 }))),
		);
		await throughFirstSync(devices, phone, account, { useFolder: "Laptop vault" }, (paragraphs) =>
			expect(paragraphs).toEqual(expect.arrayContaining(previewLines({ download: 1, upload: 2, identical: 3, differing: 4 }))),
		);
	});

	it("leaves both vaults holding the files of both and nothing else, a differing note merged the same on both", async () => {
		const { devices, account, laptop, phone } = await laptopAndPhone();
		const union = Object.keys({ ...LAPTOP_FILES, ...PHONE_FILES }).sort();

		await throughFirstSync(devices, laptop, account);
		await throughFirstSync(devices, phone, account, { useFolder: "Laptop vault" });
		laptop.runCommand("sync-now");

		await vi.waitFor(() => expect(filesOn(laptop)).toEqual(union), PLUGIN_WAIT);
		expect(filesOn(phone)).toEqual(union);
		expect(await textOn(laptop, "phone-1.md")).toBe("from the phone 1\n");
		expect(await textOn(phone, "laptop.md")).toBe("from the laptop\n");
		expect(await textOn(phone, "same-1.md")).toBe("the same on both 1\n");
		// Both versions' lines are kept in the merged note, which the laptop downloads as the phone wrote it.
		const merged = await textOn(phone, "differs-1.md");
		expect(merged).toContain("the laptop's line 1");
		expect(merged).toContain("the phone's line 1");
		await vi.waitFor(async () => expect(await textOn(laptop, "differs-1.md")).toBe(merged), PLUGIN_WAIT);
	});
});
