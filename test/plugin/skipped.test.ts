// @vitest-environment jsdom
// Manual check 12 through the whole plugin, at the real limits rather than
// a test ceiling: a file over 100 MiB, `desktop.ini` and a name ending in a
// space are skipped, stay off the Remote, and show in the Skipped tab.
import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { fill } from "../../src/ui/i18n/fill";
import { selectStrings } from "../../src/ui/i18n/strings";
import { remoteBytes, selectedTab, tabLines, useDevices } from "../support/plugin-devices";
import { DEVICE_TEST_TIMEOUT_MS } from "../support/timeouts";

const strings = selectStrings("en");

const newDevices = useDevices();

/**
 * One byte over the 100 MiB a new Remote's size ceiling allows. Written
 * out rather than read from the defaults, so a ceiling raised there fails
 * this test.
 */
const OVER_CEILING_BYTES = 100 * 1024 * 1024 + 1;

describe("files the plugin skips", { timeout: DEVICE_TEST_TIMEOUT_MS }, () => {
	it("skips a file over 100 MiB, desktop.ini and a name ending in a space, and lists each in the Skipped tab", async () => {
		const { dropbox, devices } = newDevices();
		const account = dropbox.addAccount("account-1");
		const laptop = await devices.start("Laptop vault", {
			files: {
				"note.md": "synced",
				"big.bin": new ArrayBuffer(OVER_CEILING_BYTES),
				"desktop.ini": "[.ShellClassInfo]",
				"draft ": "a name ending in a space",
			},
		});

		await devices.connect(laptop, account);
		await devices.startFirstSync(laptop);
		laptop.runCommand("show-skipped");

		expect(selectedTab(laptop)).toBe(fill(strings.tabSkipped, { count: "3" }));
		expect(tabLines(laptop)).toEqual([
			fill(strings.skippedTooLarge, { file: "big.bin" }),
			fill(strings.skippedNameNotRepresentable, { file: "desktop.ini" }),
			fill(strings.skippedNameNotRepresentable, { file: "draft " }),
		]);
		expect(laptop.status()).toContain(fill(strings.skippedCount, { count: "3" }));
		for (const path of ["big.bin", "desktop.ini", "draft ", "draft"]) {
			expect(remoteBytes(account, "Laptop vault", path), path).toBeNull();
		}
		expect(remoteBytes(account, "Laptop vault", "note.md")).not.toBeNull();
	});
});
