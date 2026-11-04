// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { selectStrings } from "../../../src/ui/i18n/strings";
import {
	authorizationCode,
	authorize,
	disconnectProgram,
	enterCodeProgram,
	hasLogin,
	leaveDropbox,
	LOOK_PROGRAM,
	newFolderProgram,
	openConnectWindowProgram,
	PRESS_PROGRAM,
	type Browser,
} from "./dropbox-login";
import { PAGE_HELPERS } from "./page";
import { runInPage } from "./page-runner";

const strings = selectStrings("en");

/** An element of `tag` with `classes`, holding `text`. */
function element(tag: keyof HTMLElementTagNameMap, classes: string, text = ""): HTMLElement {
	return createEl(tag, { cls: classes, text });
}

afterEach(() => {
	document.body.replaceChildren();
});

describe("the code on Dropbox's authorize page", () => {
	it("is read from the page's address once Dropbox shows it", () => {
		expect(authorizationCode("https://www.dropbox.com/oauth2/authorize_success?auth_code=abc-123_X&state=")).toBe("abc-123_X");
	});

	it("is absent before, on the warning and permission pages", () => {
		expect(authorizationCode("https://www.dropbox.com/oauth2/authorize?client_id=k&response_type=code")).toBeUndefined();
		expect(authorizationCode("about:blank")).toBeUndefined();
	});
});

describe("the authorize page, as the browser shows it", () => {
	const authorizePage = { href: "https://www.dropbox.com/oauth2/authorize?client_id=k", hostname: "www.dropbox.com", pathname: "/oauth2/authorize" };
	const primary = (label: string) => {
		const button = element("button", "dig-Button--primary", label);
		const clicks = vi.fn();
		button.addEventListener("click", clicks);
		document.body.append(button);
		return { button, clicks };
	};

	it("is looked at for its address, whether it is the authorize page, and a primary button not pressed yet", async () => {
		primary("Continue");
		expect(await runInPage(LOOK_PROGRAM, { location: authorizePage })).toEqual({ address: authorizePage.href, authorizePage: true, primary: true });
		expect(await runInPage(LOOK_PROGRAM, { location: { ...authorizePage, pathname: "/login" } })).toMatchObject({ authorizePage: false });
		expect(await runInPage(LOOK_PROGRAM, { location: { ...authorizePage, hostname: "dropbox.example.com" } })).toMatchObject({ authorizePage: false });
	});

	it("has its primary button pressed once, however often the press is asked while the page stays", async () => {
		const { clicks } = primary("Allow");
		await runInPage(PRESS_PROGRAM, { location: authorizePage });
		await runInPage(PRESS_PROGRAM, { location: authorizePage });
		expect(clicks).toHaveBeenCalledTimes(1);
		expect(await runInPage(LOOK_PROGRAM, { location: authorizePage })).toMatchObject({ primary: false });
	});

	it("has the same button pressed again once it reads another label, as when the page moves on in place", async () => {
		const { button, clicks } = primary("Continue");
		await runInPage(PRESS_PROGRAM, { location: authorizePage });
		button.textContent = "Allow";
		expect(await runInPage(LOOK_PROGRAM, { location: authorizePage })).toMatchObject({ primary: true });
		await runInPage(PRESS_PROGRAM, { location: authorizePage });
		expect(clicks).toHaveBeenCalledTimes(2);
	});

	it("has nothing pressed when it shows no primary button", async () => {
		expect(await runInPage(PRESS_PROGRAM, { location: authorizePage })).toBeUndefined();
		expect(await runInPage(LOOK_PROGRAM, { location: authorizePage })).toMatchObject({ primary: false });
	});
});

/** What the browser's page answers to authorize's look at it. */
interface Shown {
	readonly address: string;
	readonly authorizePage: boolean;
	readonly primary: boolean;
}

const AUTHORIZE = "https://www.dropbox.com/oauth2/authorize?client_id=the-key&response_type=code";

/**
 * A browser showing `pages` in turn: each press of the primary button
 * moves to the next page; `failing` looks fail first, as while the browser
 * starts.
 */
function browser(pages: readonly Shown[], failing = 0): Browser & { presses: number } {
	let looksLeft = failing;
	const state = {
		presses: 0,
		browserEval(body: string): Promise<unknown> {
			if (body === PRESS_PROGRAM) {
				state.presses += 1;
				return Promise.resolve(undefined);
			}
			if (body !== LOOK_PROGRAM) return Promise.reject(new Error("not a program authorize runs"));
			if (looksLeft > 0) {
				looksLeft -= 1;
				return Promise.reject(new Error("the browser is starting"));
			}
			return Promise.resolve(pages[Math.min(state.presses, pages.length - 1)]);
		},
	};
	return state;
}

describe("logging in on Dropbox's authorize page", () => {
	it("presses Continue, then Allow, and returns the code the address then carries", async () => {
		const device = browser([
			{ address: AUTHORIZE, authorizePage: true, primary: true },
			{ address: AUTHORIZE, authorizePage: true, primary: true },
			{ address: "https://www.dropbox.com/oauth2/authorize_success?auth_code=the-code", authorizePage: false, primary: false },
		]);
		expect(await authorize(device, { timeoutMs: 1000, pauseMs: 1 })).toBe("the-code");
		expect(device.presses).toBe(2);
	});

	it("presses nothing while the authorize page shows no button to press", async () => {
		const device = browser([{ address: AUTHORIZE, authorizePage: true, primary: false }]);
		await expect(authorize(device, { timeoutMs: 50, pauseMs: 1 })).rejects.toThrow("no code within 50 ms");
		expect(device.presses).toBe(0);
	});

	it("asks again while the browser is starting or the page navigating", async () => {
		const device = browser([{ address: "https://www.dropbox.com/oauth2/authorize_success?auth_code=c", authorizePage: false, primary: false }], 3);
		expect(await authorize(device, { timeoutMs: 1000, pauseMs: 1 })).toBe("c");
	});

	it("waits on a blank page, as the browser shows before Dropbox's", async () => {
		const device = browser([{ address: "about:blank", authorizePage: false, primary: false }]);
		await expect(authorize(device, { timeoutMs: 50, pauseMs: 1 })).rejects.toThrow("Dropbox's authorize page showed no code within 50 ms");
	});

	it("presses nothing on another page, such as Dropbox's login, and names its path only", async () => {
		const device = browser([{ address: "https://www.dropbox.com/login?cont=https%3A%2F%2Fwww.dropbox.com%2Foauth2%2Fauthorize%3Fclient_id%3Dthe-key", authorizePage: false, primary: true }]);
		const failure = authorize(device, { timeoutMs: 1000, pauseMs: 1 });
		await expect(failure).rejects.toThrow("Dropbox showed /login, not its authorize page");
		await expect(failure).rejects.not.toThrow(/the-key/);
		expect(device.presses).toBe(0);
	});
});

describe("the connect window, driven in the page", () => {
	/** A window (`.modal`) with `classes`, in the document. */
	const modal = (classes = "") => {
		const made = element("div", `modal ${classes}`);
		document.body.append(made);
		return made;
	};
	/** A button reading `text` in `root`, recording its clicks. */
	const buttonIn = (root: HTMLElement, text: string) => {
		const made = element("button", "", text);
		const clicks = vi.fn();
		made.addEventListener("click", clicks);
		root.append(made);
		return clicks;
	};

	it("opens from the Sync window's Connect", async () => {
		let connect = vi.fn();
		const commands = {
			executeCommandById: (id: string) => {
				if (id === "seamsync:open-sync-window") connect = buttonIn(modal("seamsync-sync-window"), strings.connect);
			},
		};
		await runInPage(`${PAGE_HELPERS}${openConnectWindowProgram(strings)}`, { app: { commands } });
		expect(connect).toHaveBeenCalledTimes(1);
	});

	it("takes a code: typed into the code field, then Continue", async () => {
		const window = modal();
		const field = createEl("input");
		field.type = "text";
		const typed = vi.fn(() => field.value);
		field.addEventListener("input", typed);
		window.append(field);
		const continued = buttonIn(window, strings.continue);
		await runInPage(`${PAGE_HELPERS}${enterCodeProgram("the-code", strings)}`, {});
		expect(typed).toHaveReturnedWith("the-code");
		expect(continued).toHaveBeenCalledTimes(1);
	});

	it("creates a new Remote folder: its name typed into the New folder field, then Create", async () => {
		const window = modal();
		const row = element("div", "setting-item");
		row.append(element("div", "setting-item-name", strings.newFolder));
		const field = createEl("input");
		const typed = vi.fn(() => field.value);
		field.addEventListener("input", typed);
		row.append(field);
		window.append(row);
		const created = buttonIn(window, strings.create);
		await runInPage(`${PAGE_HELPERS}${newFolderProgram("e2e-run", strings)}`, {});
		expect(typed).toHaveReturnedWith("e2e-run");
		expect(created).toHaveBeenCalledTimes(1);
	});
});

/** How the fake Dropbox answers the cleanup's requests: a status and JSON, or a failure. */
type Answer = { readonly status: number; readonly json?: unknown } | Error;

/**
 * A device whose page is jsdom's, for `leaveDropbox`: the plugin's login
 * `secret`, Dropbox answering the token and delete requests, and a
 * settings tab whose Disconnect (absent unless `disconnect` is given) ends
 * with that notice. `events` records, in order, the requests, the settings
 * opened and closed, and Disconnect pressed with the page flag as it then
 * was.
 */
function deviceWith({ secret, token = { status: 200, json: { access_token: "access" } }, deleted = { status: 200, json: {} }, disconnect }: {
	readonly secret: string | null;
	readonly token?: Answer;
	readonly deleted?: Answer;
	readonly disconnect?: string;
}) {
	const events: string[] = [];
	const bodies: string[] = [];
	const globals: Record<string, unknown> = {};
	const tab = element("div", "");
	if (disconnect !== undefined) {
		const row = element("div", "setting-item mod-action");
		row.append(element("div", "setting-item-name", strings.disconnect));
		row.addEventListener("click", () => {
			events.push(`Disconnect pressed, flag ${String(globals.seamsyncE2eDisconnectPressed)}`);
			document.body.append(element("div", "notice", disconnect));
		});
		tab.append(row);
	}
	globals.app = {
		secretStorage: { getSecret: () => secret },
		setting: {
			open: () => events.push("settings opened"),
			openTabById: (id: string) => events.push(`tab ${id}`),
			activeTab: { id: "seamsync", containerEl: tab },
			close: () => events.push("settings closed"),
		},
	};
	globals.URLSearchParams = URLSearchParams;
	globals.requestUrl = (request: { url: string; body?: string }) => {
		const route = request.url.replace(/^https:\/\/api\.dropboxapi\.com\//, "");
		events.push(route === "2/files/delete_v2" ? `${route} ${request.body ?? ""}` : route);
		const answer = route === "oauth2/token" ? token : deleted;
		return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
	};
	const device = {
		pluginId: "seamsync",
		strings: () => Promise.resolve(strings),
		eval: (body: string) => {
			bodies.push(body);
			// The page keeps its globals, the flag among them, from one evaluation to the next.
			return runInPage(body, globals);
		},
	};
	return { device, events, bodies, globals };
}

describe("leaving Dropbox after a run", () => {
	const notFound = { status: 409, json: { error_summary: "path_lookup/not_found/..", error: { ".tag": "path_lookup", path_lookup: { ".tag": "not_found" } } } };

	beforeEach(() => vi.stubEnv("SEAMSYNC_DROPBOX_APP_KEY", "the-key"));
	afterEach(() => vi.unstubAllEnvs());

	it("sends nothing and presses nothing when the plugin has no login", async () => {
		const { device, events } = deviceWith({ secret: null, disconnect: strings.noticeDisconnected });
		await leaveDropbox(device, "e2e-run", { deleteFolder: true });
		expect(events).toEqual([]);
	});

	it("sends nothing and presses nothing once Disconnect was pressed in the page", async () => {
		const { device, events, globals } = deviceWith({ secret: "refresh", disconnect: strings.noticeDisconnected });
		globals.seamsyncE2eDisconnectPressed = true;
		await leaveDropbox(device, "e2e-run", { deleteFolder: true });
		expect(events).toEqual([]);
	});

	it("deletes the run's Remote folder with the plugin's login, then presses Disconnect, the page flag set first", async () => {
		const { device, events } = deviceWith({ secret: "refresh", disconnect: strings.noticeDisconnected });
		await leaveDropbox(device, "e2e-run", { deleteFolder: true });
		expect(events).toEqual([
			"oauth2/token",
			`2/files/delete_v2 ${JSON.stringify({ path: "/e2e-run" })}`,
			"settings opened",
			"tab seamsync",
			"Disconnect pressed, flag true",
			"settings closed",
		]);
	});

	it("only presses Disconnect when the folder is not its to delete, with no app key in the page", async () => {
		const { device, events, bodies } = deviceWith({ secret: "refresh", disconnect: strings.noticeDisconnected });
		await leaveDropbox(device, "e2e-run", { deleteFolder: false });
		expect(events).toEqual(["settings opened", "tab seamsync", "Disconnect pressed, flag true", "settings closed"]);
		expect(bodies.join("\n")).not.toContain("the-key");
	});

	it("takes a folder already gone as deleted", async () => {
		const { device } = deviceWith({ secret: "refresh", deleted: notFound, disconnect: strings.noticeDisconnected });
		await expect(leaveDropbox(device, "e2e-run", { deleteFolder: true })).resolves.toBeUndefined();
	});

	it("fails on another 409, naming Dropbox's summary, and still disconnects", async () => {
		const busy = { status: 409, json: { error_summary: "too_many_write_operations/..", error: { ".tag": "too_many_write_operations" } } };
		const { device, events } = deviceWith({ secret: "refresh", deleted: busy, disconnect: strings.noticeDisconnected });
		await expect(leaveDropbox(device, "e2e-run", { deleteFolder: true })).rejects.toThrow(
			"deleting the run's Remote folder: HTTP 409 too_many_write_operations/..",
		);
		expect(events).toContain("Disconnect pressed, flag true");
	});

	it("fails when Dropbox refused the plugin's login, sending no delete, and still disconnects", async () => {
		const { device, events } = deviceWith({ secret: "refresh", token: { status: 400, json: { error: "invalid_grant" } }, disconnect: strings.noticeDisconnected });
		await expect(leaveDropbox(device, "e2e-run", { deleteFolder: true })).rejects.toThrow(
			"deleting the run's Remote folder: Dropbox refused the plugin's login, HTTP 400",
		);
		expect(events.filter((event) => event.startsWith("2/"))).toEqual([]);
		expect(events).toContain("Disconnect pressed, flag true");
	});

	it("fails when a request failed, and still disconnects", async () => {
		const { device, events } = deviceWith({ secret: "refresh", token: new Error("offline"), disconnect: strings.noticeDisconnected });
		await expect(leaveDropbox(device, "e2e-run", { deleteFolder: true })).rejects.toThrow("deleting the run's Remote folder: Error: offline");
		expect(events).toContain("Disconnect pressed, flag true");
	});

	it("reports both a failed delete and a Disconnect that ended with another notice", async () => {
		const { device } = deviceWith({ secret: "refresh", deleted: { status: 500 }, disconnect: strings.noticeDisconnectedRevokeFailed });
		const failure = leaveDropbox(device, "e2e-run", { deleteFolder: true });
		await expect(failure).rejects.toThrow("deleting the run's Remote folder: HTTP 500");
		await expect(failure).rejects.toThrow(`disconnecting after the run: ${strings.noticeDisconnectedRevokeFailed}`);
	});

	it("closes the settings even when Disconnect is not found", async () => {
		const { device, events } = deviceWith({ secret: "refresh" });
		await expect(leaveDropbox(device, "e2e-run", { deleteFolder: false })).rejects.toThrow("the Disconnect row");
		expect(events.at(-1)).toBe("settings closed");
	});
});

describe("whether a device still has a login to leave", () => {
	it("is yes while the plugin holds one and Disconnect was not pressed", async () => {
		expect(await hasLogin(deviceWith({ secret: "refresh" }).device)).toBe(true);
	});

	it("is no without one, or once Disconnect was pressed", async () => {
		expect(await hasLogin(deviceWith({ secret: null }).device)).toBe(false);
		const pressed = deviceWith({ secret: "refresh" });
		pressed.globals.seamsyncE2eDisconnectPressed = true;
		expect(await hasLogin(pressed.device)).toBe(false);
	});
});

describe("Disconnect, pressed in the page", () => {
	it("leaves the notice it ended with, and closes the settings", async () => {
		const { device, events } = deviceWith({ secret: "refresh", disconnect: strings.noticeDisconnectFailed });
		expect(await device.eval(`${PAGE_HELPERS}\n${disconnectProgram(strings)}\nreturn notice;`)).toBe(strings.noticeDisconnectFailed);
		expect(events).toEqual(["settings opened", "tab seamsync", "Disconnect pressed, flag true", "settings closed"]);
	});
});
