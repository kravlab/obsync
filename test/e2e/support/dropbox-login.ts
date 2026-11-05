// Logging a device in to Dropbox and out again, as the runs do it: the
// authorize page is passed in the emulator's browser, where the test
// account is logged in, the code goes into the plugin's connect window,
// and Disconnect is pressed in the plugin's settings tab. The authorize
// page's address holds the app key, so nothing here prints it.
import type { Strings } from "../../../src/ui/i18n/strings";
import { dropboxAppKey, dropboxHelpers, PLUGIN_SECRET_HELPER } from "./dropbox-page";
import { PAGE_HELPERS, type ObsidianPage } from "./page";

/** How long the login may take: the browser loading Dropbox's three pages. */
export const LOGIN_TIMEOUT_MS = 120_000;
/** How long to wait between two looks at the browser's page. */
const LOOK_PAUSE_MS = 1500;

/** The page flag set right before Disconnect is pressed (see `disconnectProgram`). */
const DISCONNECT_PRESSED = "seamsyncE2eDisconnectPressed";

/** A browser whose page runs an eval body (see `evalProgram`), as the phone's does. */
export interface Browser {
	browserEval(body: string): Promise<unknown>;
}

/** What `authorize` sees of the browser's page (LOOK_PROGRAM). */
interface Look {
	readonly address: string;
	readonly authorizePage: boolean;
	readonly primary: boolean;
}

/**
 * Page code answering what `authorize` looks at: the address, whether it
 * is Dropbox's authorize page, and whether that page shows a primary
 * button not pressed yet, as PRESS_PROGRAM marks one with its label.
 */
export const LOOK_PROGRAM = `
	const shown = document.querySelector("button.dig-Button--primary");
	return {
		address: location.href,
		authorizePage: location.hostname === "www.dropbox.com" && location.pathname === "/oauth2/authorize",
		primary: shown !== null && shown.dataset.seamsyncE2ePressed !== shown.textContent,
	};`;

/**
 * Page code pressing the page's primary button (Continue, then Allow),
 * unless it was pressed already: a press whose answer is slow to come
 * leaves the same button, and pressing it again could send a second
 * authorization. The button is marked with its label, so one the page
 * relabels in place counts as new.
 */
export const PRESS_PROGRAM = `
	const toPress = document.querySelector("button.dig-Button--primary");
	if (toPress !== null && toPress.dataset.seamsyncE2ePressed !== toPress.textContent) {
		toPress.dataset.seamsyncE2ePressed = toPress.textContent;
		toPress.click();
	}`;

/** The code Dropbox's authorize page carries in its address once it shows it, or undefined before. */
export function authorizationCode(address: string): string | undefined {
	return new URL(address).searchParams.get("auth_code") ?? undefined;
}

/**
 * Passes Dropbox's authorize page, already open in `browser`: presses the
 * page's primary button (Continue, then Allow) until the address carries
 * the code, and returns it. A look that fails, as while the browser starts
 * or the page navigates, is made again. Presses nothing on any other page,
 * such as Dropbox's login, and fails naming its path only (the address
 * holds the app key): the test account is then not logged in in the
 * browser.
 */
export async function authorize(
	browser: Browser,
	{ timeoutMs = LOGIN_TIMEOUT_MS, pauseMs = LOOK_PAUSE_MS }: { readonly timeoutMs?: number; readonly pauseMs?: number } = {},
): Promise<string> {
	const end = Date.now() + timeoutMs;
	while (Date.now() < end) {
		let page: Look | undefined;
		try {
			page = (await browser.browserEval(LOOK_PROGRAM)) as Look;
		} catch {
			// The browser is starting, or the page navigating: asked again below.
		}
		if (page && page.address !== "about:blank") {
			const code = authorizationCode(page.address);
			if (code) return code;
			if (!page.authorizePage) {
				throw new Error(
					`Dropbox showed ${new URL(page.address).pathname}, not its authorize page: log the test account in once in the emulator's browser`,
				);
			}
			if (page.primary) await browser.browserEval(PRESS_PROGRAM).catch(() => undefined);
		}
		await new Promise((resolve) => setTimeout(resolve, pauseMs));
	}
	throw new Error(`Dropbox's authorize page showed no code within ${timeoutMs} ms`);
}

/** Page code opening the connect window from the Sync window's Connect; the body starts with PAGE_HELPERS. */
export function openConnectWindowProgram(strings: Strings): string {
	return `
		const connectFrom = await openSyncWindow();
		(await button(${JSON.stringify(strings.connect)}, connectFrom)).click();`;
}

/** Page code typing `code` into the open connect window and pressing Continue; the body starts with PAGE_HELPERS. */
export function enterCodeProgram(code: string, strings: Strings): string {
	return `
		const codeField = await until(() => activeDocument.querySelector(".modal input[type=text]"), 10000, "the code field");
		codeField.value = ${JSON.stringify(code)};
		codeField.dispatchEvent(new Event("input"));
		(await button(${JSON.stringify(strings.continue)})).click();`;
}

/**
 * Page code creating the Remote folder `name` on the connect window's
 * Remote screen, once a login shows it; the body starts with PAGE_HELPERS.
 */
export function newFolderProgram(name: string, strings: Strings): string {
	return `
		const folderField = await until(
			() => [...activeDocument.querySelectorAll(".modal .setting-item")].find((item) => item.querySelector(".setting-item-name")?.textContent === ${JSON.stringify(strings.newFolder)})?.querySelector("input"),
			60000,
			"the New folder field",
		);
		folderField.value = ${JSON.stringify(name)};
		folderField.dispatchEvent(new Event("input"));
		(await button(${JSON.stringify(strings.create)})).click();`;
}

/** Whether `device`'s plugin still holds a login that Disconnect was not pressed for: read in the page, nothing sent. */
export async function hasLogin(device: ObsidianPage): Promise<boolean> {
	return (
		(await device.eval(`
		${PLUGIN_SECRET_HELPER}
		return !window.${DISCONNECT_PRESSED} && pluginSecret() !== null;`)) === true
	);
}

/** What the page answered of the folder's deletion: Dropbox's answer, its refusal of the login, or a failed request. */
type Deleted =
	| { readonly status: number; readonly json?: { readonly error_summary?: string; readonly error?: unknown } }
	| { readonly refused: number }
	| { readonly failed: string };

/**
 * What a run leaves on Dropbox goes, through `device`'s own login if it
 * still has one: the run's Remote folder `runFolder` (if `deleteFolder`),
 * then the login, by Disconnect, so it does not stay valid on the device.
 * Disconnect is pressed whatever the deletion came to; each failure is
 * reported, together. Nothing is asked of Dropbox once Disconnect was
 * pressed in the page, nor without a login. A body that deletes nothing
 * holds no app key.
 */
export async function leaveDropbox(
	device: ObsidianPage,
	runFolder: string,
	{ deleteFolder }: { readonly deleteFolder: boolean },
): Promise<void> {
	const strings = await device.strings();
	const deletion = deleteFolder
		? `
		try {
			const access = await dropboxAccess(secret);
			deleted = access.token ? await dropboxCall(access.token, "files/delete_v2", { path: ${JSON.stringify(`/${runFolder}`)} }) : { refused: access.status };
		} catch (error) {
			deleted = { failed: String(error) };
		}`
		: "";
	const left = (await device.eval(`
		${PAGE_HELPERS}
		${deleteFolder ? dropboxHelpers(dropboxAppKey()) : PLUGIN_SECRET_HELPER}
		if (window.${DISCONNECT_PRESSED}) return null;
		const secret = pluginSecret();
		if (!secret) return null;
		let deleted = null;
		${deletion}
		${disconnectProgram(strings)}
		return { deleted, notice };`)) as null | { deleted: Deleted | null; notice: string };
	if (left === null) return;
	const failures = [
		left.deleted === null ? null : deletionFailure(left.deleted),
		left.notice === strings.noticeDisconnected ? null : `disconnecting after the run: ${left.notice}`,
	];
	const reported = failures.filter((failure) => failure !== null);
	if (reported.length > 0) throw new Error(reported.join("; "));
}

/** Why deleting the run's Remote folder failed, or null if it is gone: deleted now (200), or not found (409 `path_lookup/not_found`). */
function deletionFailure(deleted: Deleted): string | null {
	const failure = (why: string) => `deleting the run's Remote folder: ${why}`;
	if ("refused" in deleted) return failure(`Dropbox refused the plugin's login, HTTP ${deleted.refused}`);
	if ("failed" in deleted) return failure(deleted.failed);
	if (deleted.status === 200) return null;
	const error = deleted.json?.error as { readonly ".tag"?: unknown; readonly path_lookup?: { readonly ".tag"?: unknown } } | undefined;
	if (deleted.status === 409 && error?.[".tag"] === "path_lookup" && error.path_lookup?.[".tag"] === "not_found") return null;
	return failure(`HTTP ${deleted.status}${deleted.json?.error_summary ? ` ${deleted.json.error_summary}` : ""}`);
}

/**
 * Page code that presses Disconnect in the plugin's settings tab and
 * leaves the notice it ended with in `notice`: an action row of the
 * declarative tab (Obsidian 1.13 and later), named after its button. The
 * page flag DISCONNECT_PRESSED is set first, so a cleanup after the run
 * sends nothing with the old login. The settings close however it ends
 * (`withSettings`). The body starts with PAGE_HELPERS.
 */
export function disconnectProgram(strings: Strings): string {
	return `
	const notice = await withSettings(async (tab) => {
		const disconnectRow = await settingRow(${JSON.stringify(strings.disconnect)}, tab);
		window.${DISCONNECT_PRESSED} = true;
		disconnectRow.click();
		// Whichever way Disconnect ends, its notice shows it.
		const outcomes = ${JSON.stringify([strings.noticeDisconnected, strings.noticeDisconnectedRevokeFailed, strings.noticeDisconnectFailed])};
		return until(() => noticeAmong(outcomes), 30000, "the Disconnect notice");
	});`;
}
