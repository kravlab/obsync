// The pair run's manual checks: a desktop Obsidian and the emulator's phone
// syncing through one Remote folder of the test account, in the order they
// need it. The phone first polls only once an hour (check 6). Each device
// writes a note and an image; the desktop logs in and creates the run's
// Remote folder, the phone logs in and connects to it; both First sync
// windows are read and both vaults then hold the union (checks 5, 9). A
// note open in the desktop's editor is changed on the phone (check 7). Then
// changes made on the desktop reach the phone when it comes back from the
// background and when its network comes back (check 6). Last, the shared
// settings and devices (check 20): a pattern the desktop adds to the ignore
// list reaches the phone; both change the size limit while the phone is
// offline, so the phone's sync meets the desktop's change in the collision
// window; the phone is renamed; and after the phone's Disconnect, which the
// cleanup below then skips, the desktop forgets it. Each check needs the
// ones before it, so the run stops at the first failure (`bail`).
//
// Two logins per run, one per device, both passed in the emulator's
// browser, where the test account is logged in: the desktop's authorize
// address is caught in its page, so no browser of the user's opens. No
// request is sent that Dropbox is expected to refuse.
import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import { NO_CONFLICTS } from "../../../src/engine/conflicts";
import { DEFAULT_REMOTE_SETTINGS } from "../../../src/engine/remote-metadata";
import { MEBIBYTE } from "../../../src/engine/request-limit";
import { parseIgnoreList } from "../../../src/engine/settings-change";
import { DEFAULT_SYNC_SCHEDULE } from "../../../src/engine/sync-schedule";
import { fill } from "../../../src/ui/i18n/fill";
import type { Strings } from "../../../src/ui/i18n/strings";
import { settingNameText, settingValueText } from "../../../src/ui/shared-settings-text";
import { statusText } from "../../../src/ui/status-text";
import { useAndroidPhone } from "../support/android-phone";
import { useDesktopObsidian } from "../support/desktop-obsidian";
import {
	authorize,
	disconnectProgram,
	enterCodeProgram,
	hasLogin,
	leaveDropbox,
	LOGIN_TIMEOUT_MS,
	newFolderProgram,
	openConnectWindowProgram,
} from "../support/dropbox-login";
import { ASK_EVERY_MS, dropboxAppKey, dropboxHelpers, SHA256_HELPER, THROTTLED_WAIT_MS } from "../support/dropbox-page";
import { CALL_MS, PAGE_HELPERS, TEST_HEADROOM_MS } from "../support/page";
import { COMPLETE_SYNC_MS, DEVICE_NAMES_HELPER, DEVICES_LIST_MS, otherDevicesHelpers, RUN_FOLDER, statusHelpers, SYNC_TIMEOUT_MS } from "../support/pair-page";
import { onePixelPng } from "../support/png";

/**
 * How long a connect's page code may wait in all: the code field, the
 * Remote screen, the Connected notice, the First sync window, then the
 * first sync (see `enterCodeProgram`, `connectedAndFirstSync`).
 */
const CONNECT_WAITS_MS = 10_000 + 3 * 60_000 + SYNC_TIMEOUT_MS;
/** How long a change may take to reach the phone after a trigger (plan, step 15). */
const TRIGGER_LIMIT_MS = 30_000;
/** The phone's polling interval during the run, in seconds: the longest allowed, so no poll brings a change in check 6. */
const PHONE_POLL_SECONDS = 3600;
/** How long after setting it the phone's last poll under the old interval has surely come. */
const OLD_POLL_GONE_MS = DEFAULT_SYNC_SCHEDULE.pollInterval.ms + 5000;
/** How long the phone stays in the background in check 6: long enough for Android to report it hidden. */
const BACKGROUND_MS = 3000;
/** Where check 7 puts the cursor in the desktop's note: before the text the phone adds. */
const CURSOR_OFFSET = 7;

/** A file a device writes into its vault: its path and bytes. */
interface VaultFile {
	readonly path: string;
	readonly bytes: Uint8Array;
}

const DESKTOP_NOTE: VaultFile = { path: "From the desktop.md", bytes: new TextEncoder().encode("Written on the desktop.\n") };
const DESKTOP_IMAGE: VaultFile = { path: "desktop.png", bytes: onePixelPng([200, 30, 7]) };
const PHONE_NOTE: VaultFile = { path: "From the phone.md", bytes: new TextEncoder().encode("Written on the phone.\n") };
const PHONE_IMAGE: VaultFile = { path: "phone.png", bytes: onePixelPng([0, 90, 255]) };

/** What check 7's phone adds after the cursor in the desktop's note. */
const PHONE_ADDITION = "Added on the phone.\n";

/** The pattern check 20's desktop adds to the shared ignore list, and a note the phone then writes that it matches. */
const IGNORED_PATTERN = "*.local.md";
const IGNORED_NOTE = "Kept on the phone.local.md";
/** The size limits, in MiB, check 20 sets on the desktop and on the phone; the collision window keeps the phone's. */
const DESKTOP_CEILING_MIB = 70;
const PHONE_CEILING_MIB = 50;
/** The name check 20 gives the phone. */
const PHONE_NAME = "Renamed phone";

/** A device's vault: each file's path with the SHA-256 of its bytes. */
type Listing = Record<string, string>;

/** When the phone's polling interval was set (check 6): the poll scheduled before still comes once. */
let phonePollSetAt: number | undefined;

// Registered first, so started first and stopped last: the phone's cleanup below still finds it running.
const desktop = useDesktopObsidian("pair", { online: true });
const phone = useAndroidPhone({
	// What a failed check leaves goes: both logins and the run's Remote folder. The phone is brought to the front and
	// online first, as a check may have failed with it in the background or offline. The folder goes through the
	// phone's login if it has one, after the desktop's Disconnect, so no device syncs with it then; else through the
	// desktop's. The desktop is closed here too, as a failure here skips its own closing. Every failure is reported.
	beforeStop: async (device) => {
		const failures: unknown[] = [];
		const attempt = async (step: () => Promise<void>): Promise<void> => {
			try {
				await step();
			} catch (error) {
				failures.push(error);
			}
		};
		try {
			await attempt(async () => {
				if (await device.obsidianRuns()) await device.showObsidian();
				else await device.reopen();
				await device.setNetwork(true);
			});
			let phoneLoggedIn = false;
			await attempt(async () => {
				phoneLoggedIn = await hasLogin(device);
			});
			await attempt(() => leaveDropbox(desktop(), RUN_FOLDER, { deleteFolder: !phoneLoggedIn }));
			await attempt(() => leaveDropbox(device, RUN_FOLDER, { deleteFolder: phoneLoggedIn }));
		} finally {
			await attempt(() => desktop().stop());
		}
		if (failures.length > 0) throw new AggregateError(failures, `cleaning up after the pair run: ${failures.map(String).join("; ")}`);
	},
});

describe("check 6: a change made on the desktop reaches the phone when it comes back", () => {
	it(
		"first makes the phone poll only once an hour, so no poll brings a change during the check",
		async () => {
			const strings = await phone().strings();
			const description = await phone().eval(`
				${PAGE_HELPERS}
				return withSettings(async (tab) => {
					const row = await settingRow(${JSON.stringify(strings.settingsPollInterval)}, tab);
					const input = row.querySelector("input");
					typeInto(input, ${JSON.stringify(String(PHONE_POLL_SECONDS))});
					return row.querySelector(".setting-item-description").textContent;
				});`);
			phonePollSetAt = Date.now();
			expect(description).toBe(strings.settingsPollIntervalDescription);
		},
		CALL_MS * 2 + TEST_HEADROOM_MS,
	);
});

describe("check 5: the second device's First sync shows its counts, and both vaults then hold the union", () => {
	it(
		"connects the desktop to a new Remote folder, then the phone to that folder",
		async () => {
			const strings = await desktop().strings();
			await desktop().eval(writeFiles([DESKTOP_NOTE, DESKTOP_IMAGE]));
			await phone().eval(writeFiles([PHONE_NOTE, PHONE_IMAGE]));
			const before = { desktop: await listing(desktop()), phone: await listing(phone()) };
			expect(before.desktop).toMatchObject(expectedListing([DESKTOP_NOTE, DESKTOP_IMAGE]));
			expect(before.phone).toMatchObject(expectedListing([PHONE_NOTE, PHONE_IMAGE]));

			// The desktop's login, passed in the phone's browser: its Open Dropbox is caught, so nothing opens on the computer.
			const address = (await desktop().eval(`
				${PAGE_HELPERS}
				${openConnectWindowProgram(strings)}
				const open = activeWindow.open;
				let address = null;
				activeWindow.open = (url) => {
					address = url;
					return null;
				};
				try {
					(await button(${JSON.stringify(strings.openDropbox)})).click();
					return await until(() => address, 10000, "the authorize address");
				} finally {
					activeWindow.open = open;
				}`)) as string;
			await phone().closeBrowser();
			await phone().eval(`activeWindow.open(${JSON.stringify(address)});`);
			const desktopCode = await authorize(phone());
			await phone().showObsidian();
			const desktopFirstSync = (await desktop().eval(
				`
				${PAGE_HELPERS}
				${enterCodeProgram(desktopCode, strings)}
				${newFolderProgram(RUN_FOLDER, strings)}
				${connectedAndFirstSync(strings)}
				return firstSync;`,
				CONNECT_WAITS_MS + CALL_MS,
			)) as FirstSyncShown;
			expectFirstSync(desktopFirstSync, strings, { toDownload: [], toUpload: Object.keys(before.desktop) });

			// The phone's login, as on the Android run.
			await phone().closeBrowser();
			await phone().eval(`
				${PAGE_HELPERS}
				${openConnectWindowProgram(strings)}
				(await button(${JSON.stringify(strings.openDropbox)})).click();`);
			const phoneCode = await authorize(phone());
			await phone().showObsidian();
			const phoneFirstSync = (await phone().eval(
				`
				${PAGE_HELPERS}
				${enterCodeProgram(phoneCode, strings)}
				const runFolder = await until(
					() => [...activeDocument.querySelectorAll(".modal .setting-item")].find((item) => item.querySelector(".setting-item-name")?.textContent === ${JSON.stringify(RUN_FOLDER)}),
					60000,
					"the run's Remote folder",
				);
				(await button(${JSON.stringify(strings.useFolder)}, runFolder)).click();
				${connectedAndFirstSync(strings)}
				return firstSync;`,
				CONNECT_WAITS_MS + CALL_MS,
			)) as FirstSyncShown;
			expectFirstSync(phoneFirstSync, strings, { toDownload: Object.keys(before.desktop), toUpload: Object.keys(before.phone) });

			// The desktop takes the phone's files at its next sync.
			const union = { ...before.desktop, ...before.phone };
			await desktop().eval(syncUntil(`${Object.keys(union).length} files`, `app.vault.getFiles().length === ${Object.keys(union).length}`), SYNC_TIMEOUT_MS + CALL_MS);
			expect(await listing(desktop())).toEqual(union);
			expect(await listing(phone())).toEqual(union);
		},
		CALL_MS * 12 + LOGIN_TIMEOUT_MS * 2 + CONNECT_WAITS_MS * 2 + SYNC_TIMEOUT_MS + TEST_HEADROOM_MS,
	);
});

describe("check 9: an image added on each device arrives on the other", () => {
	it(
		"holds both images on both devices, byte for byte",
		async () => {
			const images = expectedListing([DESKTOP_IMAGE, PHONE_IMAGE]);
			expect(await listing(desktop())).toMatchObject(images);
			expect(await listing(phone())).toMatchObject(images);
		},
		CALL_MS * 2 + TEST_HEADROOM_MS,
	);
});

describe("check 7: a note open in the desktop's editor, changed on the phone, is updated in place", () => {
	it(
		"keeps the editor and the cursor's offset when the phone's change arrives",
		async () => {
			const original = Buffer.from(DESKTOP_NOTE.bytes).toString();
			await desktop().eval(`
				const leaf = app.workspace.getLeaf(false);
				await leaf.openFile(app.vault.getAbstractFileByPath(${JSON.stringify(DESKTOP_NOTE.path)}));
				const editor = leaf.view.editor;
				editor.focus();
				editor.setCursor(editor.offsetToPos(${CURSOR_OFFSET}));
				window.obsyncE2eEditorView = leaf.view;`);
			await phone().eval(`
				const file = app.vault.getAbstractFileByPath(${JSON.stringify(DESKTOP_NOTE.path)});
				await app.vault.modify(file, ${JSON.stringify(original + PHONE_ADDITION)});
				app.commands.executeCommandById("obsync:sync-now");`);
			const shown = (await desktop().eval(
				`
				const view = window.obsyncE2eEditorView;
				${syncUntil("the phone's change in the editor", `view.editor.getValue() === ${JSON.stringify(original + PHONE_ADDITION)}`)}
				return {
					sameView: app.workspace.getActiveViewOfType(view.constructor) === view,
					text: view.editor.getValue(),
					offset: view.editor.posToOffset(view.editor.getCursor()),
				};`,
				SYNC_TIMEOUT_MS + CALL_MS,
			)) as { sameView: boolean; text: string; offset: number };
			expect(shown).toEqual({ sameView: true, text: original + PHONE_ADDITION, offset: CURSOR_OFFSET });
		},
		CALL_MS * 3 + SYNC_TIMEOUT_MS + TEST_HEADROOM_MS,
	);
});

describe("check 6: a change made on the desktop reaches the phone when it comes back", () => {
	const awayNote = "Made while the phone was away.md";
	const offlineNote = "Made while the phone was offline.md";

	it(
		"from the background, and when its network comes back",
		async () => {
			// The poll scheduled under the old interval has come by now, so the next one is an hour away.
			const pollSetAt = phonePollSetAt;
			if (pollSetAt === undefined) throw new Error("the phone's polling interval was not set");
			await new Promise((resolve) => setTimeout(resolve, Math.max(0, pollSetAt + OLD_POLL_GONE_MS - Date.now())));

			await changeOnDesktop(awayNote);
			// Not on the phone yet: only the trigger below can bring it.
			expect(await phoneHas(awayNote)).toBe(false);
			await phone().eval(`
				window.obsyncE2eHidden = false;
				document.addEventListener("visibilitychange", () => {
					if (document.visibilityState === "hidden") window.obsyncE2eHidden = true;
				});`);
			await phone().goHome();
			await new Promise((resolve) => setTimeout(resolve, BACKGROUND_MS));
			await phone().showObsidian();
			const back = (await phone().eval(`
				await until(() => app.vault.getAbstractFileByPath(${JSON.stringify(awayNote)}), ${TRIGGER_LIMIT_MS}, "the desktop's change after the phone came back");
				return { hidden: window.obsyncE2eHidden };`)) as { hidden: boolean };
			expect(back.hidden).toBe(true);

			await changeOnDesktop(offlineNote);
			expect(await phoneHas(offlineNote)).toBe(false);
			try {
				await phone().setNetwork(false);
			} finally {
				await phone().setNetwork(true);
			}
			await phone().eval(`await until(() => app.vault.getAbstractFileByPath(${JSON.stringify(offlineNote)}), ${TRIGGER_LIMIT_MS}, "the desktop's change after the network came back");`);
			expect(await phoneHas(offlineNote)).toBe(true);
		},
		OLD_POLL_GONE_MS + CALL_MS * 12 + (SYNC_TIMEOUT_MS + ASK_EVERY_MS + THROTTLED_WAIT_MS) * 2 + BACKGROUND_MS + TRIGGER_LIMIT_MS * 2 + TEST_HEADROOM_MS,
	);
});

describe("check 20: shared settings and devices", () => {
	it(
		"a pattern the desktop adds to the ignore list reaches the phone, and a note the phone writes under it does not reach the desktop",
		async () => {
			const desktopStrings = await desktop().strings();
			const phoneStrings = await phone().strings();
			await desktop().eval(
				`
				${PAGE_HELPERS}
				${statusHelpers(desktopStrings)}
				${applySharedProgram(
					desktopStrings,
					`
					const ignoreList = (await settingRow(${JSON.stringify(desktopStrings.settingsIgnoreList)}, tab)).querySelector("textarea");
					typeInto(ignoreList, [ignoreList.value, ${JSON.stringify(IGNORED_PATTERN)}].filter((line) => line !== "").join("\\n"));`,
				)}
				await completeSync("the desktop's sync writing the ignore list");`,
				COMPLETE_SYNC_MS + CALL_MS,
			);

			const phoneIgnoreList = (await phone().eval(
				`
				${PAGE_HELPERS}
				${statusHelpers(phoneStrings)}
				await completeSync("the phone's sync bringing the ignore list");
				return withSettings(async (tab) => (await settingRow(${JSON.stringify(phoneStrings.settingsIgnoreList)}, tab)).querySelector("textarea").value);`,
				COMPLETE_SYNC_MS + CALL_MS,
			)) as string;
			expect(parseIgnoreList(phoneIgnoreList)).toContain(IGNORED_PATTERN);

			const phoneStatus = await phone().eval(
				`
				${PAGE_HELPERS}
				${statusHelpers(phoneStrings)}
				await app.vault.create(${JSON.stringify(IGNORED_NOTE)}, "Written on the phone, under the ignore list.\\n");
				await completeSync("the phone's sync after its note");
				return shownStatus();`,
				COMPLETE_SYNC_MS + CALL_MS,
			);
			// The phone's sync passed the note over as ignored, and says so.
			expect(phoneStatus).toBe(statusText({ state: "synced" }, NO_CONFLICTS, [{ path: IGNORED_NOTE, reason: "ignored" }], phoneStrings));
			const remoteNames = await phone().eval(`
				${dropboxAccessProgram()}
				const listed = await dropboxCall(access.token, "files/list_folder", { path: ${JSON.stringify(`/${RUN_FOLDER}`)} });
				if (listed.status !== 200) throw new Error("listing the run's Remote folder: HTTP " + listed.status);
				return listed.json.entries.map((entry) => entry.name);`);
			expect(remoteNames).toContain(PHONE_NOTE.path);
			expect(remoteNames).not.toContain(IGNORED_NOTE);
			const desktopHasNote = await desktop().eval(
				`
				${PAGE_HELPERS}
				${statusHelpers(desktopStrings)}
				await completeSync("the desktop's sync after the phone's note");
				return app.vault.getAbstractFileByPath(${JSON.stringify(IGNORED_NOTE)}) !== null;`,
				COMPLETE_SYNC_MS + CALL_MS,
			);
			expect(desktopHasNote).toBe(false);
		},
		(COMPLETE_SYNC_MS + CALL_MS) * 4 + CALL_MS * 3 + TEST_HEADROOM_MS,
	);

	it(
		"the size limit changed on both devices asks on the phone which value to keep; closed, sync is paused; the value picked then shows on both",
		async () => {
			const desktopStrings = await desktop().strings();
			const phoneStrings = await phone().strings();
			/** Page code, in the plugin's settings tab `tab`, typing `mebibytes` into the size limit field. */
			const typeSizeLimit = (strings: Strings, mebibytes: number): string => `
				const sizeLimit = (await settingRow(${JSON.stringify(strings.settingsSizeCeiling)}, tab)).querySelector("input");
				typeInto(sizeLimit, ${JSON.stringify(String(mebibytes))});`;
			/** Page code reading the size limit field of the plugin's settings tab. */
			const readSizeLimit = (strings: Strings): string => `
				return withSettings(async (tab) => (await settingRow(${JSON.stringify(strings.settingsSizeCeiling)}, tab)).querySelector("input").value);`;

			// Offline, the phone keeps its change (stored before its sync starts) while the desktop writes another.
			try {
				await phone().setNetwork(false);
				await phone().eval(
					`
					${PAGE_HELPERS}
					${statusHelpers(phoneStrings)}
					const watch = watchStatus();
					try {
						${applySharedProgram(phoneStrings, typeSizeLimit(phoneStrings, PHONE_CEILING_MIB))}
						await untilShown(watch, ${JSON.stringify(phoneStrings.statusOffline)}, ${SYNC_TIMEOUT_MS}, "the phone's sync to end offline");
					} finally {
						watch.stop();
					}`,
					SYNC_TIMEOUT_MS + CALL_MS,
				);
				await desktop().eval(
					`
					${PAGE_HELPERS}
					${statusHelpers(desktopStrings)}
					${applySharedProgram(desktopStrings, typeSizeLimit(desktopStrings, DESKTOP_CEILING_MIB))}
					await completeSync("the desktop's sync writing its size limit");`,
					COMPLETE_SYNC_MS + CALL_MS,
				);
			} finally {
				await phone().setNetwork(true);
			}

			// The phone's sync when its network comes back meets the desktop's change.
			const collisionWindow = `() => modalTitled(${JSON.stringify(phoneStrings.collisionTitle)})`;
			const shown = (await phone().eval(
				`
				${PAGE_HELPERS}
				${statusHelpers(phoneStrings)}
				try {
					await until(${collisionWindow}, ${SYNC_TIMEOUT_MS}, "the collision window once the network came back");
					await closeModals();
					const paused = await until(() => statusIs(shownStatus(), ${JSON.stringify(phoneStrings.statusSettingsCollision)}) && shownStatus(), 10000, "the paused status");
					const watch = watchStatus();
					try {
						// Sync now asks again.
						app.commands.executeCommandById("obsync:sync-now");
						const modal = await until(${collisionWindow}, ${SYNC_TIMEOUT_MS}, "the collision window after Sync now");
						const rows = [...modal.querySelectorAll(".setting-item")].filter((row) => dropdowns(row).length > 0).map((row) => ({
							name: row.querySelector(".setting-item-name")?.textContent,
							options: [...dropdown(row).options].map((option) => option.textContent),
						}));
						// The phone's value: "mine" in the window's dropdown, which preselects this device's value.
						const choice = dropdown(modal);
						const preselected = choice.value;
						choice.value = "mine";
						choice.dispatchEvent(new Event("change"));
						(await button(${JSON.stringify(phoneStrings.collisionApply)}, modal)).click();
						await untilShown(watch, ${JSON.stringify(phoneStrings.statusSynced)}, ${SYNC_TIMEOUT_MS}, "the phone's sync after the choice");
						return { paused, rows, preselected };
					} finally {
						watch.stop();
					}
				} finally {
					await closeModals();
				}`,
				SYNC_TIMEOUT_MS * 3 + CALL_MS,
			)) as { paused: string; rows: { name: string; options: string[] }[]; preselected: string };
			// The phone still shows the count of check 20's ignored note.
			expect(shown.paused).toBe(statusText({ state: "settingsCollision" }, NO_CONFLICTS, [{ path: IGNORED_NOTE, reason: "ignored" }], phoneStrings));
			// The window preselects this device's value.
			expect(shown.preselected).toBe("mine");
			// The size limit as the window shows it, for a limit of `mebibytes`.
			const ceiling = (mebibytes: number): string => settingValueText("sizeCeilingBytes", { ...DEFAULT_REMOTE_SETTINGS, sizeCeilingBytes: mebibytes * MEBIBYTE }, phoneStrings);
			expect(shown.rows).toEqual([
				{
					name: settingNameText("sizeCeilingBytes", phoneStrings),
					options: [fill(phoneStrings.collisionMine, { value: ceiling(PHONE_CEILING_MIB) }), fill(phoneStrings.collisionRemote, { value: ceiling(DESKTOP_CEILING_MIB) })],
				},
			]);

			const desktopShows = await desktop().eval(
				`
				${PAGE_HELPERS}
				${statusHelpers(desktopStrings)}
				await completeSync("the desktop's sync bringing the phone's size limit");
				${readSizeLimit(desktopStrings)}`,
				COMPLETE_SYNC_MS + CALL_MS,
			);
			const phoneShows = await phone().eval(`
				${PAGE_HELPERS}
				${readSizeLimit(phoneStrings)}`);
			expect({ desktop: desktopShows, phone: phoneShows }).toEqual({ desktop: String(PHONE_CEILING_MIB), phone: String(PHONE_CEILING_MIB) });
		},
		CALL_MS * 8 + SYNC_TIMEOUT_MS * 4 + COMPLETE_SYNC_MS * 2 + TEST_HEADROOM_MS,
	);

	it(
		"the phone renamed in its settings shows under its new name in the desktop's Other devices",
		async () => {
			const desktopStrings = await desktop().strings();
			const phoneStrings = await phone().strings();
			await phone().eval(`
				${PAGE_HELPERS}
				await withSettings(async (tab) => {
					const row = await settingRow(${JSON.stringify(phoneStrings.deviceName)}, tab);
					const name = row.querySelector("input");
					typeInto(name, ${JSON.stringify(PHONE_NAME)});
					(await button(${JSON.stringify(phoneStrings.rename)}, row)).click();
				});`);
			// The next completed sync writes the new name to the phone's record: each ask runs one.
			await phone().eval(
				`
				${dropboxAccessProgram()}
				${DEVICE_NAMES_HELPER}
				await askDropbox(async () => {
					app.commands.executeCommandById("obsync:sync-now");
					const found = await deviceNames(access.token);
					return { status: found.status, done: found.names?.includes(${JSON.stringify(PHONE_NAME)}) === true };
				}, ${SYNC_TIMEOUT_MS}, "the phone's record under its new name");`,
				SYNC_TIMEOUT_MS + ASK_EVERY_MS + THROTTLED_WAIT_MS + CALL_MS,
			);
			const others = await desktop().eval(
				`
				${PAGE_HELPERS}
				${otherDevicesHelpers(desktopStrings)}
				return withSettings((tab) => showOtherDevices(tab));`,
				DEVICES_LIST_MS + CALL_MS,
			);
			expect(others).toEqual([PHONE_NAME]);
		},
		CALL_MS * 6 + SYNC_TIMEOUT_MS + ASK_EVERY_MS + THROTTLED_WAIT_MS + DEVICES_LIST_MS + TEST_HEADROOM_MS,
	);

	it(
		"after the phone's Disconnect, the desktop forgets it: Other devices and the run's Remote folder no longer hold it",
		async () => {
			const desktopStrings = await desktop().strings();
			const phoneStrings = await phone().strings();
			// The cleanup then finds no login on the phone and deletes the run's folder through the desktop's.
			const disconnected = await phone().eval(`
				${PAGE_HELPERS}
				${disconnectProgram(phoneStrings)}
				return notice;`);
			expect(disconnected).toBe(phoneStrings.noticeDisconnected);

			const forgotten = (await desktop().eval(
				`
				${PAGE_HELPERS}
				${otherDevicesHelpers(desktopStrings)}
				try {
					return await withSettings(async (tab) => {
						const desktopName = (await settingRow(${JSON.stringify(desktopStrings.deviceName)}, tab)).querySelector("input").value;
						// The list shown is the one part 3 read, so it does not show that the record survived the phone's Disconnect: the Remote check below carries that proof.
						await showOtherDevices(tab);
						// The list is drawn again as it is read, so rows are looked up in the whole page.
						const row = await settingRow(${JSON.stringify(PHONE_NAME)});
						(await button(${JSON.stringify(desktopStrings.forgetDevice)}, row)).click();
						const confirmation = await until(
							() => modalTitled(${JSON.stringify(fill(desktopStrings.forgetDeviceTitle, { device: PHONE_NAME }))}),
							10000,
							"the Forget confirmation",
						);
						(await button(${JSON.stringify(desktopStrings.forgetDevice)}, confirmation)).click();
						const outcomes = ${JSON.stringify([desktopStrings.noticeDeviceForgotten, desktopStrings.noticeDeviceInUse].map((template) => fill(template, { device: PHONE_NAME })))};
						const notice = await until(() => noticeAmong(outcomes), 30000, "the Forget notice");
						if (notice !== outcomes[0]) return { desktopName, notice, after: otherDeviceNames() };
						// Forget reads the other devices again.
						await until(() => rowNames().includes(${JSON.stringify(desktopStrings.settingsNoOtherDevices)}), ${DEVICES_LIST_MS}, "Other devices read again");
						return { desktopName, notice, after: otherDeviceNames() };
					});
				} finally {
					await closeModals();
				}`,
				DEVICES_LIST_MS * 3 + CALL_MS,
			)) as { desktopName: string; notice: string; after: string[] };
			const { desktopName, ...shown } = forgotten;
			expect(desktopName).not.toBe("");
			expect(shown).toEqual({
				notice: fill(desktopStrings.noticeDeviceForgotten, { device: PHONE_NAME }),
				after: [],
			});

			// The phone's login is gone after its Disconnect, so the desktop's is used, as the cleanup's folder deletion does: only the desktop's record is left.
			const remote = await desktop().eval(`
				${dropboxAccessProgram()}
				${DEVICE_NAMES_HELPER}
				return await deviceNames(access.token);`);
			expect(remote).toEqual({ status: 200, names: [desktopName] });
		},
		CALL_MS * 6 + DEVICES_LIST_MS * 2 + TEST_HEADROOM_MS,
	);
});

/** What a First sync window showed: its paragraphs, and each listed section's heading with its files. */
interface FirstSyncShown {
	readonly paragraphs: readonly string[];
	readonly lists: Readonly<Record<string, readonly string[]>>;
}

/**
 * Expects `shown` to count and list `toDownload` and `toUpload`, in any
 * order, with nothing the same or different on both sides.
 */
function expectFirstSync(shown: FirstSyncShown, strings: Strings, { toDownload, toUpload }: Record<"toDownload" | "toUpload", readonly string[]>): void {
	const heading = (template: string, paths: readonly string[]): string => fill(template, { count: String(paths.length) });
	expect(shown.paragraphs).toEqual(
		expect.arrayContaining([
			heading(strings.firstSyncToDownload, toDownload),
			heading(strings.firstSyncToUpload, toUpload),
			heading(strings.firstSyncIdentical, []),
			heading(strings.firstSyncDiffering, []),
		]),
	);
	const lists: Record<string, readonly string[]> = {};
	if (toDownload.length > 0) lists[heading(strings.firstSyncToDownload, toDownload)] = [...toDownload].sort();
	if (toUpload.length > 0) lists[heading(strings.firstSyncToUpload, toUpload)] = [...toUpload].sort();
	expect(shown.lists).toEqual(lists);
}

/** Each of `files` with the SHA-256 of its bytes, as `listing` gives them. */
function expectedListing(files: readonly VaultFile[]): Listing {
	return Object.fromEntries(files.map(({ path, bytes }) => [path, createHash("sha256").update(bytes).digest("hex")]));
}

/** `device`'s vault files, each with the SHA-256 of its bytes: read in the page, with no app key there. */
async function listing(device: ReturnType<typeof desktop> | ReturnType<typeof phone>): Promise<Listing> {
	return (await device.eval(`
		${SHA256_HELPER}
		const files = await Promise.all(app.vault.getFiles().map(async (file) => [file.path, await sha256(await app.vault.readBinary(file))]));
		return Object.fromEntries(files);`)) as Listing;
}

/** Whether the phone's vault holds `path`. */
async function phoneHas(path: string): Promise<boolean> {
	return (await phone().eval(`return app.vault.getAbstractFileByPath(${JSON.stringify(path)}) !== null;`)) === true;
}

/** Page code writing `files` into the vault. */
function writeFiles(files: readonly VaultFile[]): string {
	const encoded = files.map(({ path, bytes }) => ({ path, base64: Buffer.from(bytes).toString("base64") }));
	return `
		for (const { path, base64 } of ${JSON.stringify(encoded)}) {
			await app.vault.createBinary(path, Uint8Array.from(atob(base64), (char) => char.charCodeAt(0)).buffer);
		}`;
}

/**
 * Page code waiting for the Connected notice and the First sync window,
 * leaving what the window shows in `firstSync`, then starting the first
 * sync and waiting until the device shows Synced: the ribbon icon's label
 * on a phone, the status bar item's text on a desktop (see `statusHelpers`,
 * which the code defines for the rest of the body). A device never synced
 * before shows Synced only once that first sync is done.
 */
function connectedAndFirstSync(strings: Strings): string {
	return `
		await until(() => [...activeDocument.querySelectorAll(".notice")].find((n) => n.textContent === ${JSON.stringify(strings.noticeConnected)}), 60000, "the Connected notice");
		// A new Connection shows the onboarding; the first sync starts once it is closed.
		(await button(${JSON.stringify(strings.onboardingDone)})).click();
		const firstSyncWindow = await until(
			() => modalTitled(${JSON.stringify(strings.firstSyncTitle)}),
			60000,
			"the First sync window",
		);
		const firstSync = {
			paragraphs: [...firstSyncWindow.querySelectorAll(".modal-content > p")].map((p) => p.textContent),
			lists: Object.fromEntries(
				[...firstSyncWindow.querySelectorAll(".obsync-first-sync-list > strong")].map((heading) => [
					heading.textContent,
					[...heading.nextElementSibling.querySelectorAll("li")].map((item) => item.textContent).sort(),
				]),
			),
		};
		(await button(${JSON.stringify(strings.firstSyncStart)}, firstSyncWindow)).click();
		${statusHelpers(strings)}
		await until(() => statusIs(shownStatus(), ${JSON.stringify(strings.statusSynced)}), ${SYNC_TIMEOUT_MS}, "the Synced status");`;
}

/**
 * Page code running Sync now every ASK_EVERY_MS until `done`, a page
 * expression, holds; fails after SYNC_TIMEOUT_MS naming `what`. Each sync
 * is requests, so it is not asked for more often; an error `done` throws
 * fails it at once.
 */
function syncUntil(what: string, done: string): string {
	return `
		const syncEnd = Date.now() + ${SYNC_TIMEOUT_MS};
		for (;;) {
			app.commands.executeCommandById("obsync:sync-now");
			const askEnd = Date.now() + ${ASK_EVERY_MS};
			while (!(${done}) && Date.now() < askEnd) await wait(100);
			if (${done}) break;
			if (Date.now() >= syncEnd) throw new Error(${JSON.stringify(`timed out after ${SYNC_TIMEOUT_MS} ms waiting for ${what}`)});
		}`;
}

/**
 * Makes a note `path` on the desktop and syncs it, then waits until
 * Dropbox holds it, asked through the phone's login (the phone stays in
 * front, with no poll due): the phone then finds it at its next sync. The
 * run's folder is listed, not the note looked up, so no ask is answered
 * 409 while the note is not there yet.
 */
async function changeOnDesktop(path: string): Promise<void> {
	await desktop().eval(`
		await app.vault.create(${JSON.stringify(path)}, "Made on the desktop.\\n");
		app.commands.executeCommandById("obsync:sync-now");`);
	await phone().eval(
		`
		${dropboxAccessProgram()}
		await askDropbox(async () => {
			const listed = await dropboxCall(access.token, "files/list_folder", { path: ${JSON.stringify(`/${RUN_FOLDER}`)} });
			return { status: listed.status, done: listed.json?.entries?.some((entry) => entry.name === ${JSON.stringify(path)}) === true };
		}, ${SYNC_TIMEOUT_MS}, "the desktop's change");`,
		SYNC_TIMEOUT_MS + ASK_EVERY_MS + THROTTLED_WAIT_MS + CALL_MS,
	);
}

/**
 * Page code changing the shared settings in the plugin's settings tab as a
 * user does: `edit`, page code given the tab's contents as `tab`, then
 * "Apply to all devices"; the settings close however it ends. The change is
 * stored on the device before its sync starts. The body starts with
 * PAGE_HELPERS.
 */
function applySharedProgram(strings: Strings, edit: string): string {
	return `
		await withSettings(async (tab) => {
			${edit}
			const applyRow = await settingRow(${JSON.stringify(strings.settingsApplyShared)}, tab);
			(await button(${JSON.stringify(strings.settingsApplyShared)}, applyRow)).click();
		});`;
}

/**
 * Page code leaving an access token of the device's own login in
 * `access.token`: defines dropboxHelpers' helpers, then reads the plugin's
 * stored login and exchanges it for the token; fails when the device is not
 * connected or Dropbox refuses the login.
 */
function dropboxAccessProgram(): string {
	return `
		${dropboxHelpers(dropboxAppKey())}
		const secret = pluginSecret();
		if (!secret) throw new Error("the device is not connected");
		const access = await dropboxAccess(secret);
		if (!access.token) throw new Error("no access token: HTTP " + access.status);`;
}
