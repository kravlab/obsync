// @vitest-environment jsdom
// Manual checks 4 and 14 through the whole plugin: the status bar item and
// the phone's ribbon icon follow the state and open the Sync window; its
// commands open their tab; each tab shows its list; the Activity tab shows
// a failed sync with its detail and copies the bug report; on a phone the
// windows of connecting and syncing are fitted for it. The Deletion guard,
// Restore and Edit windows are checked with their own scenarios.
import "fake-indexeddb/auto";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { fill } from "../../src/ui/i18n/fill";
import { selectStrings } from "../../src/ui/i18n/strings";
import { statusIcon, statusTone } from "../../src/ui/status-look";
import { json } from "../fakes/fake-dropbox";
import {
	fileOn,
	lastSyncWindow,
	remoteText,
	selectedTab,
	syncWindows,
	tabLines,
	useDevices,
	type PluginDevice,
} from "../support/plugin-devices";
import { PLUGIN_WAIT, buttonIn } from "../support/plugin-run";
import { DEVICE_TEST_TIMEOUT_MS } from "../support/timeouts";

const strings = selectStrings("en");

const newDevices = useDevices();

/** Clicks the tab labelled `label`, its count included, of the Sync window `device` opened last; fails when there is none. */
function openTab(device: PluginDevice, label: string): void {
	const tab = [...lastSyncWindow(device).querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
		(button) => button.textContent === label,
	);
	if (tab === undefined) throw new Error(`no tab ${label}`);
	tab.click();
}

describe("the status entry point and the Sync window", { timeout: DEVICE_TEST_TIMEOUT_MS }, () => {
	it("shows the state on the status bar item, and opens the Sync window on a click and on Enter", async () => {
		const { dropbox, devices } = newDevices();
		const account = dropbox.addAccount("account-1");
		const laptop = await devices.start("Laptop vault", { files: { "note.md": "hello" } });
		const item = laptop.plugin.statusBarItems[0];
		if (item === undefined) throw new Error("no status bar item");
		const dot = item.querySelector(".seamsync-dot");

		expect(laptop.status()).toContain(strings.statusNotConnected);
		expect(dot?.className).toBe(`seamsync-dot seamsync-dot-${statusTone({ state: "notConnected" })}`);
		expect(laptop.plugin.ribbonIcons).toHaveLength(0);
		await devices.connect(laptop, account);
		await devices.startFirstSync(laptop);
		expect(dot?.className).toBe(`seamsync-dot seamsync-dot-${statusTone({ state: "synced" })}`);

		item.click();
		const clicked = lastSyncWindow(laptop);
		expect(clicked.textContent).toContain(strings.statusSynced);
		expect(clicked.querySelector(".seamsync-sync-header button")?.textContent).toBe(strings.syncNow);
		// One Sync window is open at a time: Enter opens a new one in place of the first.
		item.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
		expect(syncWindows(laptop)).toHaveLength(1);
		expect(lastSyncWindow(laptop)).not.toBe(clicked);
	});

	it("opens each command's tab", async () => {
		const { devices } = newDevices();
		const laptop = await devices.start("Laptop vault");
		const opened: Record<string, string> = {};
		let previous: HTMLElement | undefined;

		for (const command of ["open-sync-window", "show-conflicts", "show-skipped", "show-activity", "show-help"]) {
			laptop.runCommand(command);
			// Each command opens a window of its own, in place of the one open.
			expect(syncWindows(laptop)).toHaveLength(1);
			expect(lastSyncWindow(laptop)).not.toBe(previous);
			previous = lastSyncWindow(laptop);
			opened[command] = selectedTab(laptop);
		}

		expect(opened).toEqual({
			"open-sync-window": fill(strings.tabConflicts, { count: "0" }),
			"show-conflicts": fill(strings.tabConflicts, { count: "0" }),
			"show-skipped": fill(strings.tabSkipped, { count: "0" }),
			"show-activity": strings.tabActivity,
			"show-help": strings.tabHelp,
		});
	});

	it("shows the help in its tab, and the welcome screen again from it", async () => {
		const { devices } = newDevices();
		const laptop = await devices.start("Laptop vault");

		laptop.runCommand("show-help");
		const help = lastSyncWindow(laptop);

		expect([...help.querySelectorAll("h4")].map((heading) => heading.textContent)).toEqual([
			strings.helpPracticesHeading,
			strings.helpConflictsHeading,
			strings.helpOutsideHeading,
			strings.helpConfigurationHeading,
			strings.helpSkippedHeading,
		]);
		expect(help.textContent).toContain(strings.practiceOneDeviceFirst);
		expect(help.textContent).toContain(".seamsync");
		buttonIn(help, strings.showOnboarding).click();
		await vi.waitFor(() => expect(laptop.button(strings.onboardingDone)).toBeDefined(), PLUGIN_WAIT);
		expect(syncWindows(laptop)).toHaveLength(0);
	});

	it("lists in each tab the conflicts, the skipped files and the activity", async () => {
		const { dropbox, devices } = newDevices();
		const account = dropbox.addAccount("account-1");
		// Two names differing only in case cannot both be stored in Dropbox, so both are skipped.
		const laptop = await devices.start("Laptop vault", { files: { "note.md": "first line\n", "a.md": "a", "A.md": "A" } });
		const phone = await devices.start("Phone vault", { phone: true });
		await devices.connectBoth(laptop, phone, account);
		// The same line changed on both devices, the phone's first: the laptop's sync finds the conflict.
		await phone.app.vault.process(fileOn(phone, "note.md"), () => "the phone's line\n");
		phone.runCommand("sync-now");
		await vi.waitFor(() => expect(remoteText(account, "Laptop vault", "note.md")).toBe("the phone's line\n"), PLUGIN_WAIT);
		await laptop.app.vault.process(fileOn(laptop, "note.md"), () => "the laptop's line\n");
		laptop.runCommand("sync-now");
		await vi.waitFor(() => expect(laptop.status()).toContain(fill(strings.conflictsCount, { count: "1" })), PLUGIN_WAIT);

		laptop.runCommand("show-conflicts");
		expect(tabLines(laptop)).toEqual(["note.md"]);
		openTab(laptop, fill(strings.tabSkipped, { count: "2" }));
		expect(tabLines(laptop)).toEqual([
			fill(strings.skippedCaseClash, { file: "A.md" }),
			fill(strings.skippedCaseClash, { file: "a.md" }),
		]);
		expect(selectedTab(laptop)).toBe(fill(strings.tabSkipped, { count: "2" }));
		openTab(laptop, strings.tabActivity);
		// A Conflict block has no event of its own; the laptop's First sync, which uploaded only the note, has.
		const firstSyncDone = fill(strings.noticeFirstSyncDone, { downloaded: "0", uploaded: "1", conflicted: "0", copies: "0" });
		expect(tabLines(laptop)).toEqual(expect.arrayContaining([expect.stringContaining(firstSyncDone)]));
		openTab(laptop, fill(strings.tabConflicts, { count: "1" }));
		expect(tabLines(laptop)).toEqual(["note.md"]);
	});

	it("shows a failed sync with its detail in the Activity tab, and copies the bug report with it", async () => {
		const { dropbox, devices } = newDevices();
		const account = dropbox.addAccount("account-1");
		const laptop = await devices.start("Laptop vault", { files: { "note.md": "hello" } });
		await devices.connect(laptop, account);
		await devices.startFirstSync(laptop);
		const clipboard = { writeText: vi.fn<(text: string) => Promise<void>>(() => Promise.resolve()) };
		Object.defineProperty(navigator, "clipboard", { value: clipboard, configurable: true });
		onTestFinished(() => {
			Reflect.deleteProperty(navigator, "clipboard");
		});
		const failed = fill(strings.activitySyncFailed, { cause: strings.failurePermanent });

		// Dropbox refuses the next request, which no retry gets past.
		dropbox.interceptions.push(json(400, { error_summary: "refused for the test/" }));
		laptop.runCommand("sync-now");
		laptop.runCommand("show-activity");

		await vi.waitFor(() => expect(tabLines(laptop)[0]).toContain(failed), PLUGIN_WAIT);
		const failure = tabLines(laptop)[0] ?? "";
		expect(failure).toContain("HTTP 400");
		expect(laptop.plugin.statusBarItems[0]?.querySelector(".seamsync-dot")?.className).toBe(
			`seamsync-dot seamsync-dot-${statusTone({ state: "syncFailed", cause: "permanent" })}`,
		);
		buttonIn(lastSyncWindow(laptop), strings.copyBugReport).click();
		await vi.waitFor(() => expect(laptop.notices()).toContain(strings.bugReportCopied), PLUGIN_WAIT);
		const report = clipboard.writeText.mock.calls[0]?.[0] ?? "";
		expect(report.split("\n")[0]).toBe(strings.bugReportTitle);
		expect(report).toContain(failure);
	});

	it("shows the state on a phone's ribbon icon, opens the Sync window from it, and fits the windows it opens for a phone", async () => {
		const { dropbox, devices } = newDevices();
		const account = dropbox.addAccount("account-1");
		const phone = await devices.start("Phone vault", { phone: true, files: { "note.md": "hello" } });
		const icon = phone.plugin.ribbonIcons[0];
		if (icon === undefined) throw new Error("no ribbon icon");

		expect(phone.status()).toContain(strings.statusNotConnected);
		expect(icon.getAttribute("data-icon")).toBe(statusIcon({ state: "notConnected" }));
		await devices.connect(phone, account);
		await devices.startFirstSync(phone);
		expect(icon.getAttribute("data-icon")).toBe(statusIcon({ state: "synced" }));
		icon.click();

		expect(lastSyncWindow(phone).textContent).toContain(strings.syncWindowTitle);
		const modals = phone.windowsOpened();
		expect(modals.map((modal) => modal.titleEl.textContent)).toEqual([
			strings.connectTitle,
			strings.onboardingTitle,
			strings.firstSyncTitle,
			strings.syncWindowTitle,
		]);
		for (const modal of modals) expect(modal.modalEl.classList, modal.titleEl.textContent).toContain("seamsync-phone");
	});
});
