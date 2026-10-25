// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
	AuthorizationOutcome,
	ConnectionService,
	CreateRemoteOutcome,
	JoinOutcome,
	RemoteCandidate,
	RemoteChooser,
} from "../../src/engine/connection";
import { ProviderError } from "../../src/engine/provider";
import { ConnectModal } from "../../src/ui/connect-modal";
import { fill } from "../../src/ui/i18n/fill";
import { selectStrings } from "../../src/ui/i18n/strings";
import { Notice } from "../fakes/obsidian";

const strings = selectStrings("en");

/** What the fake connection service answers at each step; a function that throws plays a failure. */
interface Script {
	submitCode: () => Promise<AuthorizationOutcome>;
	list?: () => Promise<readonly RemoteCandidate[]>;
	useFolder?: () => Promise<JoinOutcome>;
	createRemote?: () => Promise<CreateRemoteOutcome>;
}

/** A connection service that answers the code as `script` says. */
function serviceFor(script: Pick<Script, "submitCode">): ConnectionService {
	return {
		showStatus: () => Promise.resolve(),
		currentDevice: () => Promise.resolve(null),
		disconnect: () => Promise.resolve({ kind: "disconnected" }),
		startAuthorization: () =>
			Promise.resolve({ authorizeUrl: "https://example.com/authorize", submitCode: () => script.submitCode() }),
	};
}

/** A Remote choice offering the folder "Notes", answering as `script` says. */
function remotesFor(script: Omit<Script, "submitCode">): RemoteChooser {
	return {
		list: script.list ?? (() => Promise.resolve([{ root: "/Notes", name: "Notes", isRemote: true }])),
		useFolder: script.useFolder ?? (() => Promise.resolve({ kind: "connected" })),
		createRemote: script.createRemote ?? (() => Promise.resolve({ kind: "connected" })),
	};
}

/** The open connect window, after it showed the login screen. */
async function openWindow(script: Pick<Script, "submitCode">): Promise<ConnectModal> {
	const modal = new ConnectModal({} as never, serviceFor(script), strings, "My vault", () => undefined);
	modal.open();
	await vi.waitFor(() => expect(button(modal, strings.continue)).toBeDefined());
	return modal;
}

/** The button of `modal` with the text `text`, if it shows one. */
function button(modal: ConnectModal, text: string): HTMLButtonElement | undefined {
	return [...modal.contentEl.querySelectorAll("button")].find((found) => found.textContent === text);
}

/** Pastes a code into the login screen of `modal` and presses Continue. */
function submitCode(modal: ConnectModal): void {
	const input = modal.contentEl.querySelector("input");
	if (input === null) throw new Error("no code field");
	input.value = "code";
	input.dispatchEvent(new Event("input"));
	button(modal, strings.continue)?.click();
}

/** The message, detail line and copy button `modal` shows at the top. */
function shown(modal: ConnectModal): { message: string; detail: string; copy: boolean } {
	return {
		message: modal.contentEl.querySelector(".obsync-message")?.textContent ?? "",
		detail: modal.contentEl.querySelector(".obsync-message-detail")?.textContent ?? "",
		copy: button(modal, strings.copyError) !== undefined,
	};
}

/**
 * Logs in, then presses `choice`: "Use" on the folder "Notes", or "Create"
 * for a new Remote. `useFolder`, when given, takes the place of the
 * script's, seeing the arguments it is called with.
 */
async function chooseFolder(
	script: Omit<Script, "submitCode">,
	choice = strings.useFolder,
	useFolder?: RemoteChooser["useFolder"],
): Promise<ConnectModal> {
	const remotes = { ...remotesFor(script), ...(useFolder === undefined ? {} : { useFolder }) };
	const modal = await openWindow({ submitCode: () => Promise.resolve({ kind: "authorized", remotes }) });
	submitCode(modal);
	await vi.waitFor(() => expect(button(modal, choice)).toBeDefined());
	button(modal, choice)?.click();
	return modal;
}

/** The clipboard the window writes to; jsdom has none of its own. */
let clipboard: { writeText: ReturnType<typeof vi.fn<(text: string) => Promise<void>>> };

beforeEach(() => {
	clipboard = { writeText: vi.fn<(text: string) => Promise<void>>(() => Promise.resolve()) };
	Object.defineProperty(navigator, "clipboard", { value: clipboard, configurable: true });
});

afterEach(() => {
	document.body.replaceChildren();
	vi.restoreAllMocks();
});

describe("the connect window's failures", () => {
	it("shows a refused code with the service's answer and a button that copies both", async () => {
		const modal = await openWindow({ submitCode: () => Promise.resolve({ kind: "codeRejected", detail: "invalid_grant" }) });

		submitCode(modal);
		await vi.waitFor(() => expect(shown(modal).copy).toBe(true));
		button(modal, strings.copyError)?.click();

		expect(shown(modal)).toEqual({ message: strings.codeRejected, detail: "Details: invalid_grant", copy: true });
		expect(clipboard.writeText).toHaveBeenCalledWith(`${strings.codeRejected}\nDetails: invalid_grant`);
		await vi.waitFor(() => expect(Notice.shown).toEqual([strings.errorCopied]));
	});

	it("shows a login to another account with the copy button", async () => {
		const modal = await openWindow({ submitCode: () => Promise.resolve({ kind: "otherAccount" }) });

		submitCode(modal);

		await vi.waitFor(() => expect(shown(modal)).toEqual({ message: strings.otherAccount, detail: "", copy: true }));
	});

	it("shows a provider failure with its detail and the copy button", async () => {
		const modal = await openWindow({
			submitCode: () => Promise.reject(new ProviderError({ category: "permanent" }, "HTTP 400: bad client_id")),
		});

		submitCode(modal);

		await vi.waitFor(() =>
			expect(shown(modal)).toEqual({ message: strings.errorFailed, detail: "Details: HTTP 400: bad client_id", copy: true }),
		);
	});

	it("shows an unexpected failure with its name and message, instead of dropping it", async () => {
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const unexpected = new TypeError("boom");
		const modal = await openWindow({ submitCode: () => Promise.reject(unexpected) });

		submitCode(modal);

		await vi.waitFor(() =>
			expect(shown(modal)).toEqual({ message: strings.connectUnexpected, detail: "Details: TypeError: boom", copy: true }),
		);
		expect(consoleError).toHaveBeenCalledWith("obsync: connecting failed unexpectedly", unexpected);
	});

	it.each([
		["a taken name", { kind: "nameTaken" }, strings.folderTaken],
		["a name with a slash", { kind: "invalidName" }, strings.folderNameInvalid],
	] as const)("shows %s for a new Remote with the copy button", async (_, outcome, message) => {
		const modal = await chooseFolder({ createRemote: () => Promise.resolve(outcome) }, strings.create);

		await vi.waitFor(() => expect(shown(modal)).toEqual({ message, detail: "", copy: true }));
	});

	it("shows a folder the provider cannot sync with the copy button", async () => {
		const modal = await chooseFolder({ useFolder: () => Promise.resolve({ kind: "unsupportedProvider" }) });

		await vi.waitFor(() =>
			expect(shown(modal)).toEqual({ message: strings.providerUnsupported, detail: "", copy: true }),
		);
	});

	it("shows another device's First sync with the copy button", async () => {
		const modal = await chooseFolder({
			useFolder: () => Promise.resolve({ kind: "firstSyncInProgress", deviceName: "Tablet" }),
		});

		await vi.waitFor(() => expect(shown(modal).copy).toBe(true));
		expect(shown(modal).message).toBe(fill(strings.firstSyncInProgress, { device: "Tablet" }));
	});

	it("shows an unexpected failure while setting up a folder, with the copy button", async () => {
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		const modal = await chooseFolder({ useFolder: () => Promise.reject(new TypeError("boom")) });

		await vi.waitFor(() =>
			expect(shown(modal)).toEqual({ message: strings.connectUnexpected, detail: "Details: TypeError: boom", copy: true }),
		);
	});

	it("shows a provider failure while setting up a folder, with its detail and the copy button", async () => {
		const modal = await chooseFolder({
			useFolder: () => Promise.reject(new ProviderError({ category: "transient" }, "no response")),
		});

		await vi.waitFor(() =>
			expect(shown(modal)).toEqual({ message: strings.errorUnreachable, detail: "Details: no response", copy: true }),
		);
	});

	it("tells the user when the clipboard refuses the error", async () => {
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
		clipboard.writeText.mockImplementation(() => Promise.reject(new Error("denied")));
		const modal = await openWindow({ submitCode: () => Promise.resolve({ kind: "otherAccount" }) });

		submitCode(modal);
		await vi.waitFor(() => expect(shown(modal).copy).toBe(true));
		button(modal, strings.copyError)?.click();

		await vi.waitFor(() => expect(Notice.shown).toEqual([strings.errorNotCopied]));
		expect(consoleError).toHaveBeenCalled();
	});
});

describe("the connect window's Connect anyway", () => {
	/** How many "Connect anyway" buttons `modal` shows. */
	const connectAnywayButtons = (modal: ConnectModal): number =>
		[...modal.contentEl.querySelectorAll("button")].filter((found) => found.textContent === strings.connectAnyway).length;

	/** Presses the button of `modal` with the text `text`; fails when there is none. */
	const press = (modal: ConnectModal, text: string): void => {
		const found = button(modal, text);
		if (found === undefined) throw new Error(`no button ${text}`);
		found.click();
	};

	it("shows one button however often the folder is chosen again", async () => {
		const devices = ["Tablet", "Phone"];
		const modal = await chooseFolder({
			useFolder: () => Promise.resolve({ kind: "firstSyncInProgress", deviceName: devices.shift() ?? "none" }),
		});
		await vi.waitFor(() => expect(connectAnywayButtons(modal)).toBe(1));

		press(modal, strings.useFolder);
		await vi.waitFor(() => expect(shown(modal).message).toBe(fill(strings.firstSyncInProgress, { device: "Phone" })));

		expect(connectAnywayButtons(modal)).toBe(1);
	});

	it("goes away when another message replaces its own", async () => {
		const modal = await chooseFolder({
			useFolder: () => Promise.resolve({ kind: "firstSyncInProgress", deviceName: "Tablet" }),
			createRemote: () => Promise.resolve({ kind: "nameTaken" }),
		});
		await vi.waitFor(() => expect(connectAnywayButtons(modal)).toBe(1));

		press(modal, strings.create);

		await vi.waitFor(() => expect(shown(modal).message).toBe(strings.folderTaken));
		expect(connectAnywayButtons(modal)).toBe(0);
	});

	it("connects to the folder anyway when pressed", async () => {
		const useFolder = vi.fn((_root: string, _name: string, options?: { readonly evenDuringFirstSync?: boolean }) =>
			Promise.resolve<JoinOutcome>(
				options?.evenDuringFirstSync === true ? { kind: "connected" } : { kind: "firstSyncInProgress", deviceName: "Tablet" },
			),
		);
		const modal = await chooseFolder({}, strings.useFolder, useFolder);
		await vi.waitFor(() => expect(connectAnywayButtons(modal)).toBe(1));

		press(modal, strings.connectAnyway);

		await vi.waitFor(() => expect(Notice.shown).toEqual([strings.noticeConnected]));
		expect(useFolder).toHaveBeenLastCalledWith("/Notes", strings.deviceDesktop, { evenDuringFirstSync: true });
	});
});
