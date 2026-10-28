// The pair run's manual checks: a desktop Obsidian and the emulator's phone
// syncing through one Remote folder of the test account, in the order they
// need it. The phone first polls only once an hour (check 6). Each device
// writes a note and an image; the desktop logs in and creates the run's
// Remote folder, the phone logs in and connects to it; both First sync
// windows are read and both vaults then hold the union (checks 5, 9). A
// note open in the desktop's editor is changed on the phone (check 7). Last,
// changes made on the desktop reach the phone when it comes back from the
// background and when its network comes back (check 6). Each check needs
// the ones before it, so the run stops at the first failure (`bail`).
//
// Two logins per run, one per device, both passed in the emulator's
// browser, where the test account is logged in: the desktop's authorize
// address is caught in its page, so no browser of the user's opens. No
// request is sent that Dropbox is expected to refuse.
import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import { DEFAULT_SYNC_SCHEDULE } from "../../../src/engine/sync-schedule";
import { fill } from "../../../src/ui/i18n/fill";
import type { Strings } from "../../../src/ui/i18n/strings";
import { useAndroidPhone } from "../support/android-phone";
import { useDesktopObsidian } from "../support/desktop-obsidian";
import {
	authorize,
	enterCodeProgram,
	hasLogin,
	leaveDropbox,
	LOGIN_TIMEOUT_MS,
	newFolderProgram,
	openConnectWindowProgram,
} from "../support/dropbox-login";
import { ASK_EVERY_MS, dropboxAppKey, dropboxHelpers, SHA256_HELPER, THROTTLED_WAIT_MS } from "../support/dropbox-page";
import { CALL_MS, PAGE_HELPERS, TEST_HEADROOM_MS } from "../support/page";
import { onePixelPng } from "../support/png";

/** The run's Remote folder, in the app folder: named with the run's time, deleted at the end. */
const RUN_FOLDER = `e2e-${new Date().toISOString().replace(/[:.]/g, "-")}`;
/** How long a sync started by a test may take: a few small files. */
const SYNC_TIMEOUT_MS = 120_000;
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
				app.setting.open();
				try {
					app.setting.openTabById(${JSON.stringify(phone().pluginId)});
					const row = await until(
						() => [...app.setting.activeTab.containerEl.querySelectorAll(".setting-item")].find((item) => item.querySelector(".setting-item-name")?.textContent === ${JSON.stringify(strings.settingsPollInterval)}),
						10000,
						"the polling interval setting",
					);
					const input = row.querySelector("input");
					input.value = ${JSON.stringify(String(PHONE_POLL_SECONDS))};
					input.dispatchEvent(new Event("input"));
					return row.querySelector(".setting-item-description").textContent;
				} finally {
					app.setting.close();
				}`);
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
 * on a phone, the status bar item's text on a desktop. A device never
 * synced before shows Synced only once that first sync is done.
 */
function connectedAndFirstSync(strings: Strings): string {
	return `
		await until(() => [...activeDocument.querySelectorAll(".notice")].find((n) => n.textContent === ${JSON.stringify(strings.noticeConnected)}), 60000, "the Connected notice");
		// A new Connection shows the onboarding; the first sync starts once it is closed.
		(await button(${JSON.stringify(strings.onboardingDone)})).click();
		const firstSyncWindow = await until(
			() => [...activeDocument.querySelectorAll(".modal")].find((m) => m.querySelector(".modal-title")?.textContent === ${JSON.stringify(strings.firstSyncTitle)}),
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
		const synced = ${JSON.stringify(strings.statusSynced)};
		await until(
			() => activeDocument.querySelector("[aria-label=" + JSON.stringify(synced) + "]") || [...activeDocument.querySelectorAll(".obsync-status")].some((item) => item.textContent === synced),
			${SYNC_TIMEOUT_MS},
			"the Synced status",
		);`;
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
		${dropboxHelpers(dropboxAppKey())}
		const secret = pluginSecret();
		if (!secret) throw new Error("the phone is not connected");
		const access = await dropboxAccess(secret);
		if (!access.token) throw new Error("no access token: HTTP " + access.status);
		await askDropbox(async () => {
			const listed = await dropboxCall(access.token, "files/list_folder", { path: ${JSON.stringify(`/${RUN_FOLDER}`)} });
			return { status: listed.status, done: listed.json?.entries?.some((entry) => entry.name === ${JSON.stringify(path)}) === true };
		}, ${SYNC_TIMEOUT_MS}, "the desktop's change");`,
		SYNC_TIMEOUT_MS + ASK_EVERY_MS + THROTTLED_WAIT_MS + CALL_MS,
	);
}
