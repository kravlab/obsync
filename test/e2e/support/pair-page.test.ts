// @vitest-environment jsdom
import { createContext, runInContext } from "node:vm";
import { afterEach, describe, expect, it } from "vitest";
import { fill } from "../../../src/ui/i18n/fill";
import { selectStrings } from "../../../src/ui/i18n/strings";
import { dropboxHelpers } from "./dropbox-page";
import { PAGE_HELPERS } from "./page";
import { runInPage } from "./page-runner";
import { DEVICE_NAMES_HELPER, DEVICES_LIST_MS, DEVICES_PATH, otherDevicesHelpers, statusHelpers, SYNC_TIMEOUT_MS } from "./pair-page";

const strings = selectStrings("en");

afterEach(() => {
	document.body.replaceChildren();
});

/** The desktop's status bar item, showing `text`. */
function addStatusItem(text: string): HTMLElement {
	return document.body.createDiv({ cls: "seamsync-status", text });
}

/** An element labelled `label`, such as the phone's ribbon icon. */
function addLabelled(label: string): HTMLElement {
	return document.body.createDiv({ attr: { "aria-label": label } });
}

/** `body` run in a page that holds PAGE_HELPERS and the status helpers, over `globals`. */
function inStatusPage(body: string, globals: Record<string, unknown> = {}): Promise<unknown> {
	return runInPage(`${PAGE_HELPERS}\n${statusHelpers(strings)}\n${body}`, { MutationObserver, ...globals });
}

/** Obsidian's commands, whose `executeCommandById` logs the id in `ran` and then runs `respond`. */
function commands(respond: (ran: string[]) => void) {
	const ran: string[] = [];
	return { globals: { app: { commands: { executeCommandById: (id: string) => (ran.push(id), respond(ran)) } } }, ran };
}

describe("shownStatus()", () => {
	it("is the text of the status bar item on a desktop, though a labelled element is there too", async () => {
		addLabelled(strings.statusOffline);
		addStatusItem(strings.statusSynced);
		expect(await inStatusPage("return shownStatus();")).toBe(strings.statusSynced);
	});

	it("is the label of the element that carries one of the statuses on a phone, with counts or not", async () => {
		addLabelled("Settings");
		addLabelled(fill(strings.statusWithCount, { status: strings.statusOffline, count: "3" }));
		expect(await inStatusPage("return shownStatus();")).toBe(
			fill(strings.statusWithCount, { status: strings.statusOffline, count: "3" }),
		);
	});

	it("is null when neither the item nor a labelled element shows a status", async () => {
		addLabelled("Settings");
		expect(await inStatusPage("return shownStatus();")).toBeNull();
	});
});

describe("statusIs()", () => {
	it("is true for the status alone, or with counts after it", async () => {
		const withCount = fill(strings.statusWithCount, { status: strings.statusSynced, count: "2" });
		const shown = await inStatusPage(
			`return [statusIs(${JSON.stringify(strings.statusSynced)}, ${JSON.stringify(strings.statusSynced)}), statusIs(${JSON.stringify(withCount)}, ${JSON.stringify(strings.statusSynced)})];`,
		);
		expect(shown).toEqual([true, true]);
	});

	it("is false for another status, text that only starts with the label, and what is no text", async () => {
		const synced = JSON.stringify(strings.statusSynced);
		const other = JSON.stringify(fill(strings.statusWithCount, { status: strings.statusSyncing, count: "2" }));
		const shown = await inStatusPage(
			`return [statusIs(${JSON.stringify(strings.statusOffline)}, ${synced}), statusIs(${other}, ${synced}), statusIs(${JSON.stringify(`${strings.statusSynced} up`)}, ${synced}), statusIs(null, ${synced})];`,
		);
		expect(shown).toEqual([false, false, false, false]);
	});
});

describe("watchStatus()", () => {
	it("records the status shown now, then each change, once until it changes again", async () => {
		const item = addStatusItem(strings.statusSynced);
		const seen = await inStatusPage(
			`
			const watch = watchStatus();
			const item = activeDocument.querySelector(".seamsync-status");
			item.textContent = ${JSON.stringify(strings.statusSyncing)};
			await wait(0);
			item.textContent = ${JSON.stringify(strings.statusSynced)};
			await wait(0);
			item.textContent = ${JSON.stringify(strings.statusSynced)};
			await wait(0);
			return watch.seen;`,
		);
		expect(seen).toEqual([strings.statusSynced, strings.statusSyncing, strings.statusSynced]);
		expect(item.textContent).toBe(strings.statusSynced);
	});

	it("records nothing once stopped", async () => {
		addStatusItem(strings.statusSynced);
		const seen = await inStatusPage(
			`
			const watch = watchStatus();
			watch.stop();
			activeDocument.querySelector(".seamsync-status").textContent = ${JSON.stringify(strings.statusOffline)};
			await wait(0);
			return watch.seen;`,
		);
		expect(seen).toEqual([strings.statusSynced]);
	});
});

describe("untilShown()", () => {
	it("does not take the status shown when the watch started for one seen after it, and fails listing what was seen", async () => {
		addStatusItem(strings.statusSynced);
		await expect(
			inStatusPage(`
				const watch = watchStatus();
				await untilShown(watch, ${JSON.stringify(strings.statusSynced)}, 3000, "the sync");`),
		).rejects.toThrow(`timed out after 3000 ms waiting for the sync; shown: ${JSON.stringify([strings.statusSynced])}`);
	});

	it("lists every status seen in its failure", async () => {
		addStatusItem(strings.statusSynced);
		await expect(
			inStatusPage(`
				const watch = watchStatus();
				activeDocument.querySelector(".seamsync-status").textContent = ${JSON.stringify(strings.statusSyncing)};
				await wait(0);
				await untilShown(watch, ${JSON.stringify(strings.statusSynced)}, 3000, "the sync");`),
		).rejects.toThrow(`shown: ${JSON.stringify([strings.statusSynced, strings.statusSyncing])}`);
	});

	it("resolves once the status is seen after the watch started, with counts after it or not", async () => {
		addStatusItem(strings.statusSynced);
		const withCount = fill(strings.statusWithCount, { status: strings.statusSynced, count: "2" });
		const seen = await inStatusPage(
			`
			const watch = watchStatus();
			const item = activeDocument.querySelector(".seamsync-status");
			const waiting = untilShown(watch, ${JSON.stringify(strings.statusSynced)}, 1000000, "the sync");
			item.textContent = ${JSON.stringify(strings.statusSyncing)};
			await wait(0);
			item.textContent = ${JSON.stringify(withCount)};
			await waiting;
			return watch.seen;`,
		);
		expect(seen).toEqual([strings.statusSynced, strings.statusSyncing, withCount]);
	});
});

describe("completeSync()", () => {
	/** A device whose sync shows Syncing, then, in the next tick, Synced. */
	function syncingDevice() {
		const item = addStatusItem(strings.statusSynced);
		return commands(() => {
			item.textContent = strings.statusSyncing;
			setTimeout(() => {
				item.textContent = strings.statusSynced;
			}, 0);
		});
	}

	it("runs Sync now twice, waiting for Synced after each", async () => {
		const { globals, ran } = syncingDevice();
		await inStatusPage(`await completeSync("the sync");`, globals);
		expect(ran).toEqual(["seamsync:sync-now", "seamsync:sync-now"]);
	});

	it("fails naming the first Sync now when the first sync does not end, without asking again", async () => {
		const item = addStatusItem(strings.statusSynced);
		const { globals, ran } = commands(() => {
			item.textContent = strings.statusSyncing;
		});
		await expect(inStatusPage(`await completeSync("the sync");`, globals)).rejects.toThrow(
			`timed out after ${SYNC_TIMEOUT_MS} ms waiting for the sync (Sync now 1 of 2); shown: ${JSON.stringify([strings.statusSynced, strings.statusSyncing])}`,
		);
		expect(ran).toEqual(["seamsync:sync-now"]);
	});

	it("fails naming the second Sync now when only the first sync ends: a Synced seen before it does not count", async () => {
		const item = addStatusItem(strings.statusSynced);
		const { globals, ran } = commands((asked) => {
			item.textContent = strings.statusSyncing;
			if (asked.length === 1) {
				setTimeout(() => {
					item.textContent = strings.statusSynced;
				}, 0);
			}
		});
		await expect(inStatusPage(`await completeSync("the sync");`, globals)).rejects.toThrow(
			/waiting for the sync \(Sync now 2 of 2\); shown: /,
		);
		expect(ran).toEqual(["seamsync:sync-now", "seamsync:sync-now"]);
	});
});

/** A settings row named `name`, with a button of that text if given. */
function addRow(root: HTMLElement, name: string, buttonText?: string): HTMLElement {
	const row = root.createDiv({ cls: "setting-item" });
	row.createDiv({ cls: "setting-item-name", text: name });
	if (buttonText !== undefined) row.createEl("button", { text: buttonText });
	return row;
}

/** An open window holding a settings tab; the tab is `.vertical-tab-content`. */
function addSettingsTab(): HTMLElement {
	return document.body.createDiv({ cls: "modal" }).createDiv({ cls: "vertical-tab-content" });
}

/** `body` run in a page that holds PAGE_HELPERS and the Other devices helpers. */
function inDevicesPage(body: string): Promise<unknown> {
	return runInPage(`${PAGE_HELPERS}\n${otherDevicesHelpers(strings)}\n${body}`, {});
}

describe("rowNames()", () => {
	it("lists the names of the settings rows in open windows, not those outside them", async () => {
		const tab = addSettingsTab();
		addRow(tab, "First");
		addRow(tab, "Second", "Go");
		addRow(document.body, "Outside");
		expect(await inDevicesPage("return rowNames();")).toEqual(["First", "Second"]);
	});
});

describe("otherDeviceNames()", () => {
	it("lists the names of the rows with a Forget button, one per other device", async () => {
		const tab = addSettingsTab();
		addRow(tab, "Show devices", strings.showDevices);
		addRow(tab, "Phone", strings.forgetDevice);
		addRow(tab, "This device");
		addRow(tab, "Tablet", strings.forgetDevice);
		addRow(document.body, "Outside", strings.forgetDevice);
		expect(await inDevicesPage("return otherDeviceNames();")).toEqual(["Phone", "Tablet"]);
	});
});

describe("showOtherDevices()", () => {
	/** A tab with the Show devices row, whose button, pressed, replaces the row with `after`; the presses are counted in `pressed`. */
	function tabWithShowRow(after: (tab: HTMLElement) => void): { pressed: () => number } {
		const tab = addSettingsTab();
		const show = addRow(tab, strings.showDevices, strings.showDevices);
		let presses = 0;
		show.querySelector("button")!.addEventListener("click", () => {
			presses += 1;
			show.remove();
			after(tab);
		});
		return { pressed: () => presses };
	}
	const showProgram = `return showOtherDevices(activeDocument.querySelector(".vertical-tab-content"));`;

	it("presses Show devices and resolves with the other devices' names once read", async () => {
		const { pressed } = tabWithShowRow((tab) => {
			addRow(tab, "Phone", strings.forgetDevice);
			addRow(tab, "Tablet", strings.forgetDevice);
		});
		expect(await inDevicesPage(showProgram)).toEqual(["Phone", "Tablet"]);
		expect(pressed()).toBe(1);
	});

	it("does not press it when the list is shown already", async () => {
		const tab = addSettingsTab();
		addRow(tab, "Phone", strings.forgetDevice);
		expect(await inDevicesPage(showProgram)).toEqual(["Phone"]);
	});

	it("resolves with no names when the tab says there are none", async () => {
		tabWithShowRow((tab) => addRow(tab, strings.settingsNoOtherDevices));
		expect(await inDevicesPage(showProgram)).toEqual([]);
	});

	it("fails when the tab says the devices could not be read", async () => {
		tabWithShowRow((tab) => addRow(tab, strings.settingsDevicesUnavailable));
		await expect(inDevicesPage(showProgram)).rejects.toThrow("the other devices could not be read");
	});

	it(`fails naming the other devices when nothing shows within ${DEVICES_LIST_MS} ms`, async () => {
		tabWithShowRow(() => undefined);
		await expect(inDevicesPage(showProgram)).rejects.toThrow(`timed out after ${DEVICES_LIST_MS} ms waiting for the other devices`);
	});
});

/** A request as the Dropbox helpers hand it to Obsidian's requestUrl. */
interface Request {
	readonly url: string;
	readonly headers?: Record<string, string>;
	readonly body?: string;
}

/** An answer of the fake requestUrl. */
interface Answer {
	readonly status: number;
	readonly json?: unknown;
	readonly arrayBuffer?: ArrayBuffer;
}

describe("deviceNames()", () => {
	/** A device record on the fake Dropbox: its path, and the bytes the download answers. */
	interface DeviceRecord {
		readonly path: string;
		readonly bytes: Uint8Array;
	}
	const record = (path: string, deviceName: string): DeviceRecord => ({
		path,
		bytes: new TextEncoder().encode(JSON.stringify({ deviceName })),
	});

	/** The path a download request asks for. */
	const askedPath = (request: Request): string => (JSON.parse(request.headers?.["Dropbox-API-Arg"] ?? "{}") as { path: string }).path;

	/**
	 * `deviceNames(token)` run in Node over a fake `requestUrl`, as the Dropbox
	 * helpers' own tests run them: `listing` answers the records folder, the
	 * download answers the bytes of the record whose path it is asked for.
	 */
	function deviceNamesOver(listing: Answer, records: readonly DeviceRecord[] = []) {
		const sent: Request[] = [];
		const requestUrl = (request: Request): Promise<Answer> => {
			sent.push(request);
			if (request.url.endsWith("/files/list_folder")) return Promise.resolve(listing);
			const bytes = records.find((found) => found.path === askedPath(request))!.bytes;
			return Promise.resolve({ status: 206, arrayBuffer: bytes.slice().buffer });
		};
		const page = createContext({ requestUrl, crypto, URLSearchParams, setTimeout, TextDecoder });
		const run = runInContext(`(() => {${dropboxHelpers("the-key")}\n${DEVICE_NAMES_HELPER}\nreturn { deviceNames };})()`, page) as {
			deviceNames: (token: string) => Promise<unknown>;
		};
		return { deviceNames: run.deviceNames, sent };
	}

	/** A listing answer holding `records` as files, and a folder. */
	const listed = (records: readonly DeviceRecord[], extra: object = {}): Answer => ({
		status: 200,
		json: {
			entries: [
				{ ".tag": "folder", path_lower: `${DEVICES_PATH}/old`, name: "old" },
				...records.map(({ path, bytes }) => ({ ".tag": "file", path_lower: path, size: bytes.length })),
			],
			has_more: false,
			...extra,
		},
	});

	it("reads the device name of each record in the run's device records folder, leaving the folders out", async () => {
		const records = [record(`${DEVICES_PATH}/a.json`, "Desktop"), record(`${DEVICES_PATH}/b.json`, "Phone")];
		const { deviceNames, sent } = deviceNamesOver(listed(records), records);
		expect(await deviceNames("access")).toEqual({ status: 200, names: ["Desktop", "Phone"] });
		expect(JSON.parse(sent[0]?.body ?? "")).toEqual({ path: DEVICES_PATH });
		expect(sent.slice(1).map(askedPath)).toEqual(records.map(({ path }) => path));
	});

	it("answers no names for a folder with no records", async () => {
		const { deviceNames } = deviceNamesOver(listed([]));
		expect(await deviceNames("access")).toEqual({ status: 200, names: [] });
	});

	it("answers Dropbox's status with no names when the folder cannot be listed, downloading nothing", async () => {
		const { deviceNames, sent } = deviceNamesOver({ status: 409, json: { error_summary: "path/not_found/" } });
		expect(await deviceNames("access")).toEqual({ status: 409, names: null });
		expect(sent).toHaveLength(1);
	});

	it("fails when Dropbox cuts the listing into pages", async () => {
		const { deviceNames } = deviceNamesOver(listed([], { has_more: true }));
		await expect(deviceNames("access")).rejects.toThrow("the device records were listed in pages");
	});
});
