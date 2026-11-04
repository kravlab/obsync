// The pair run's page programs that carry logic of their own, apart from
// the scenarios in `pair.test.ts` (a test file cannot be imported without
// registering its tests): reading the sync status a device shows, listing
// the settings tab's Other devices, and reading the device records on
// Dropbox. Each builds eval page code to put after PAGE_HELPERS. Their
// tests are in `pair-page.test.ts`.
import { DEVICES_FOLDER } from "../../../src/engine/remote-metadata";
import { fill } from "../../../src/ui/i18n/fill";
import type { Strings } from "../../../src/ui/i18n/strings";

/** The run's Remote folder, in the app folder: named with the run's time, deleted at the end. */
export const RUN_FOLDER = `e2e-${new Date().toISOString().replace(/[:.]/g, "-")}`;
/** How long a sync started by a test may take: a few small files. */
export const SYNC_TIMEOUT_MS = 120_000;
/** How long `completeSync` may take: two syncs. */
export const COMPLETE_SYNC_MS = SYNC_TIMEOUT_MS * 2;
/** How long the desktop may take to list the other devices: a full listing of the Remote and a read of each record. */
export const DEVICES_LIST_MS = 60_000;
/** The run's folder of device records on Dropbox. */
export const DEVICES_PATH = `/${RUN_FOLDER}/${DEVICES_FOLDER}`;

/**
 * Eval helpers about the plugin's sync status on a device showing
 * `strings`, to put after PAGE_HELPERS:
 *
 * - `statusIs(shown, label)` tells whether the status text `shown` is the
 *   status `label`, alone or with counts after it (`statusWithCount`);
 * - `shownStatus()` is the status the device shows: the status bar item's
 *   text on a desktop, else the label of the element (the phone's ribbon
 *   icon) whose label is one of Syncing, Synced, Offline, Sync failed and
 *   Paused (choose shared settings); null when there is none;
 * - `watchStatus()` records each status shown from now on, after the one
 *   shown now, in `seen`, until `stop()`;
 * - `untilShown(watch, label, ms, what)` waits until `watch` recorded the
 *   status `label` after the first entry; fails after `ms` naming `what`
 *   and what was recorded;
 * - `completeSync(what)` runs Sync now and waits for Synced, twice. The
 *   first wait may end with a sync that was under way, but the second ends
 *   only with one that started after the first Sync now, so a change
 *   stored before the call has been through a whole sync; fails after
 *   COMPLETE_SYNC_MS naming `what`.
 */
export function statusHelpers(strings: Strings): string {
	const labels = [strings.statusSyncing, strings.statusSynced, strings.statusOffline, strings.statusSyncFailed, strings.statusSettingsCollision];
	const counted = Object.fromEntries(labels.map((label) => [label, fill(strings.statusWithCount, { status: label, count: "" })]));
	return `
		const countedStatus = ${JSON.stringify(counted)};
		const statusIs = (shown, label) => typeof shown === "string" && (shown === label || shown.startsWith(countedStatus[label]));
		const shownStatus = () => {
			const item = activeDocument.querySelector(".seamsync-status");
			if (item) return item.textContent;
			const icon = [...activeDocument.querySelectorAll("[aria-label]")].find((element) => Object.keys(countedStatus).some((label) => statusIs(element.getAttribute("aria-label"), label)));
			return icon ? icon.getAttribute("aria-label") : null;
		};
		const watchStatus = () => {
			const seen = [shownStatus()];
			const observer = new MutationObserver(() => {
				const shown = shownStatus();
				if (shown !== seen[seen.length - 1]) seen.push(shown);
			});
			observer.observe(activeDocument.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["aria-label"] });
			return { seen, stop: () => observer.disconnect() };
		};
		const untilShown = async (watch, label, ms, what) => {
			const end = Date.now() + ms;
			while (!watch.seen.slice(1).some((shown) => statusIs(shown, label))) {
				if (Date.now() >= end) throw new Error("timed out after " + ms + " ms waiting for " + what + "; shown: " + JSON.stringify(watch.seen));
				await wait(100);
			}
		};
		const completeSync = async (what) => {
			for (const round of [1, 2]) {
				const watch = watchStatus();
				try {
					app.commands.executeCommandById("seamsync:sync-now");
					await untilShown(watch, ${JSON.stringify(strings.statusSynced)}, ${SYNC_TIMEOUT_MS}, what + " (Sync now " + round + " of 2)");
				} finally {
					watch.stop();
				}
			}
		};`;
}

/**
 * Eval helper `deviceNames(token)`, to put after `dropboxAccessProgram()`: the device
 * names the run's device records on Dropbox hold, read with `token`, as
 * `{ status: 200, names }`; `{ status, names: null }` when Dropbox lists the
 * records folder with another status. A listing Dropbox cuts into pages
 * fails: the run's two records fit in one.
 */
export const DEVICE_NAMES_HELPER = `
	const deviceNames = async (token) => {
		const listed = await dropboxCall(token, "files/list_folder", { path: ${JSON.stringify(DEVICES_PATH)} });
		if (listed.status !== 200) return { status: listed.status, names: null };
		if (listed.json.has_more) throw new Error("the device records were listed in pages");
		const names = [];
		for (const entry of listed.json.entries) {
			if (entry[".tag"] !== "file") continue;
			const bytes = await dropboxDownload(token, entry.path_lower, entry.size);
			names.push(JSON.parse(new TextDecoder().decode(bytes)).deviceName);
		}
		return { status: 200, names };
	};`;

/**
 * Eval helpers about the settings tab's Other devices on a device showing
 * `strings`, to put after PAGE_HELPERS, with the settings open:
 *
 * - `rowNames()` lists the names of the open windows' settings rows;
 * - `otherDeviceNames()` lists the names of the rows with a Forget button,
 *   one per other device;
 * - `showOtherDevices(tab)` presses "Show devices" in the tab's contents
 *   `tab`, unless the list is shown already, and resolves with the other
 *   devices' names once read: empty when the tab says there are none.
 *   Fails when the tab says they could not be read, or after
 *   DEVICES_LIST_MS.
 */
export function otherDevicesHelpers(strings: Strings): string {
	return `
		const rowNames = () => [...activeDocument.querySelectorAll(".modal .setting-item-name")].map((name) => name.textContent);
		const otherDeviceNames = () => [...activeDocument.querySelectorAll(".modal .setting-item")]
			.filter((row) => [...row.querySelectorAll("button")].some((b) => b.textContent === ${JSON.stringify(strings.forgetDevice)}))
			.map((row) => row.querySelector(".setting-item-name")?.textContent);
		const showOtherDevices = async (tab) => {
			const show = [...tab.querySelectorAll(".setting-item")].find((row) => row.querySelector(".setting-item-name")?.textContent === ${JSON.stringify(strings.showDevices)});
			if (show) (await button(${JSON.stringify(strings.showDevices)}, show)).click();
			// The list replaces the row once read; an empty list is an array, so it ends the wait too.
			return until(() => {
				const names = otherDeviceNames();
				if (names.length > 0) return names;
				const rows = rowNames();
				if (rows.includes(${JSON.stringify(strings.settingsDevicesUnavailable)})) throw new Error("the other devices could not be read");
				return rows.includes(${JSON.stringify(strings.settingsNoOtherDevices)}) ? names : null;
			}, ${DEVICES_LIST_MS}, "the other devices");
		};`;
}
