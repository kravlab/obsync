import { Modal, Notice, Setting, type App } from "obsidian";
import type {
	ConnectionService,
	CreateRemoteOutcome,
	JoinOutcome,
	PendingAuthorization,
	RemoteCandidate,
	RemoteChooser,
} from "../engine/connection";
import { ProviderError } from "../engine/provider";
import { defaultDeviceName } from "./device-name";
import { providerErrorDetailLine, providerErrorMessage } from "./error-message";
import { fill } from "./i18n/fill";
import type { Strings } from "./i18n/strings";
import { fitForPhone } from "./phone-modal";

/**
 * The connect window. Two screens, each driving the connection service:
 *
 * 1. Login: open the Dropbox authorize page in the browser, paste the code
 *    shown there. A refused code starts a new login with a new page.
 * 2. Remote: use one of the App Folder's subfolders (those holding a synced
 *    vault are marked), or create a new one, named after the vault by
 *    default; the device name is edited here too.
 *
 * Failures show as a message at the top of the current screen, a provider
 * failure with what the provider answered under it; a failed Remote choice
 * also lists the folders again, since it may have left a new folder
 * behind. While a request runs, further clicks are ignored, so a code is
 * never sent twice.
 */
export class ConnectModal extends Modal {
	private messageEl: HTMLElement | undefined;
	/** Under the message: what the provider answered on a failure. */
	private detailLineEl: HTMLElement | undefined;
	private busy = false;
	/** The folders listed last, kept when listing them again fails. */
	private candidates: readonly RemoteCandidate[] = [];
	/** The device name as edited, kept across redraws of the Remote screen. */
	private deviceName: string | undefined;
	/** The new Remote's name as edited, kept across redraws. */
	private folderName: string | undefined;

	/**
	 * @param app the Obsidian app
	 * @param service connects this device
	 * @param strings the UI strings in the user's language
	 * @param vaultName the default name of a new Remote
	 * @param onConnected called once the device is connected, or reconnected to the account it was connected to
	 */
	constructor(
		app: App,
		private readonly service: ConnectionService,
		private readonly strings: Strings,
		private readonly vaultName: string,
		private readonly onConnected: (how: "connected" | "reconnected") => void,
	) {
		super(app);
		fitForPhone(this);
	}

	override onOpen(): void {
		this.setTitle(this.strings.connectTitle);
		void this.showLogin();
	}

	override onClose(): void {
		this.contentEl.empty();
	}

	/** Shows the login screen for a new login, with `message` above it if given. */
	private async showLogin(message?: ScreenMessage): Promise<void> {
		this.startScreen(message);
		const pending = await this.run(() => this.service.startAuthorization());
		if (!pending) return;
		const { contentEl, strings } = this;
		contentEl.createEl("p", { text: strings.loginInstructions });
		new Setting(contentEl).addButton((button) =>
			button
				.setButtonText(strings.openDropbox)
				.setCta()
				.onClick(() => {
					activeWindow.open(pending.authorizeUrl);
				}),
		);
		let code = "";
		new Setting(contentEl)
			.setName(strings.loginCode)
			.addText((text) => text.onChange((value) => (code = value)))
			.addButton((button) =>
				button.setButtonText(strings.continue).onClick(() => {
					// Pasted codes often carry a line break or spaces around them.
					if (code.trim() !== "") void this.submit(pending, code.trim());
				}),
			);
	}

	/** Submits the pasted code and goes on as the outcome says. */
	private async submit(pending: PendingAuthorization, code: string): Promise<void> {
		const outcome = await this.run(() => pending.submitCode(code));
		switch (outcome?.kind) {
			case undefined:
				return;
			case "codeRejected":
				return this.showLogin({ text: this.strings.codeRejected });
			case "otherAccount":
				this.showMessage({ text: this.strings.otherAccount });
				return;
			case "reconnected":
				this.done(this.strings.noticeReconnected, "reconnected");
				return;
			case "authorized":
				return this.showRemotes(outcome.remotes);
		}
	}

	/**
	 * Shows the Remote screen after a login, listing the folders afresh,
	 * with `message` at the top if given. If listing fails, the folders
	 * listed before stay and the failure is shown unless `message` is given.
	 */
	private async showRemotes(remotes: RemoteChooser, message?: ScreenMessage): Promise<void> {
		const listed = await this.attempt(() => remotes.list());
		if (!listed) return;
		if (listed.ok) this.candidates = listed.value;
		this.startScreen(message ?? (listed.ok ? undefined : listed.message));
		const { contentEl, strings } = this;
		const fallbackName = defaultDeviceName(strings);
		this.deviceName ??= fallbackName;
		this.folderName ??= this.vaultName;
		const chosenDeviceName = (): string => this.deviceName?.trim() || fallbackName;

		contentEl.createEl("p", { text: strings.chooseInstructions });
		new Setting(contentEl)
			.setName(strings.deviceName)
			.setDesc(strings.deviceNameDescription)
			.addText((text) => text.setValue(this.deviceName ?? "").onChange((value) => (this.deviceName = value)));

		if (this.candidates.length === 0) contentEl.createEl("p", { text: strings.noFolders });
		for (const candidate of this.candidates) {
			new Setting(contentEl)
				.setName(candidate.name)
				.setDesc(candidate.isRemote ? strings.folderIsRemote : strings.folderIsPlain)
				.addButton((button) =>
					button.setButtonText(strings.useFolder).onClick(() => {
						void this.connectWith(remotes, (evenDuringFirstSync) =>
							remotes.useFolder(candidate.root, chosenDeviceName(), { evenDuringFirstSync }),
						);
					}),
				);
		}

		new Setting(contentEl)
			.setName(strings.newFolder)
			.addText((text) => text.setValue(this.folderName ?? "").onChange((value) => (this.folderName = value)))
			.addButton((button) =>
				button.setButtonText(strings.create).onClick(() => {
					const name = this.folderName?.trim() ?? "";
					if (name !== "") void this.connectWith(remotes, () => remotes.createRemote(name, chosenDeviceName()));
				}),
			);
	}

	/**
	 * Runs one Remote choice, first without connecting during another
	 * device's First sync. A refused name or a folder that cannot be synced
	 * is shown on the same screen; a failure lists the folders again with
	 * its message. Another device's First sync in progress is shown with a
	 * button that runs the choice again, connecting anyway.
	 */
	private async connectWith(
		remotes: RemoteChooser,
		choice: (evenDuringFirstSync: boolean) => Promise<CreateRemoteOutcome | JoinOutcome>,
		evenDuringFirstSync = false,
	): Promise<void> {
		const result = await this.attempt(() => choice(evenDuringFirstSync));
		if (!result) return;
		if (!result.ok) return this.showRemotes(remotes, result.message);
		switch (result.value.kind) {
			case "connected":
				this.done(this.strings.noticeConnected, "connected");
				return;
			case "nameTaken":
				this.showMessage({ text: this.strings.folderTaken });
				return;
			case "invalidName":
				this.showMessage({ text: this.strings.folderNameInvalid });
				return;
			case "unsupportedProvider":
				this.showMessage({ text: this.strings.providerUnsupported });
				return;
			case "firstSyncInProgress":
				this.showMessage({ text: fill(this.strings.firstSyncInProgress, { device: result.value.deviceName }) });
				new Setting(this.contentEl).addButton((button) =>
					button.setButtonText(this.strings.connectAnyway).onClick(() => void this.connectWith(remotes, choice, true)),
				);
				return;
		}
	}

	/** Tells the user the device is connected, `how`, and closes the window. */
	private done(notice: string, how: "connected" | "reconnected"): void {
		new Notice(notice);
		this.onConnected(how);
		this.close();
	}

	/** Clears the window for a new screen, with `message` at the top if given. */
	private startScreen(message?: ScreenMessage): void {
		this.contentEl.empty();
		this.messageEl = this.contentEl.createEl("p", { cls: "obsync-message" });
		this.detailLineEl = this.contentEl.createEl("p", { cls: "obsync-message-detail" });
		if (message) this.showMessage(message);
	}

	/** Shows `message` at the top of the current screen, replacing the one shown, its detail line included. */
	private showMessage(message: ScreenMessage): void {
		this.messageEl?.setText(message.text);
		this.detailLineEl?.setText(message.detailLine ?? "");
	}

	/**
	 * Runs one request and shows its provider failure, if any, at the top of
	 * the current screen; yields undefined on a failure or when another
	 * request is running.
	 */
	private async run<T>(request: () => Promise<T>): Promise<T | undefined> {
		const result = await this.attempt(request);
		if (!result) return undefined;
		if (result.ok) return result.value;
		this.showMessage(result.message);
		return undefined;
	}

	/**
	 * Runs one request unless another is running (then yields undefined). A
	 * provider failure comes back with the message telling it and what the
	 * provider answered; any other error is a bug and propagates.
	 */
	private async attempt<T>(
		request: () => Promise<T>,
	): Promise<{ readonly ok: true; readonly value: T } | { readonly ok: false; readonly message: ScreenMessage } | undefined> {
		if (this.busy) return undefined;
		this.busy = true;
		try {
			return { ok: true, value: await request() };
		} catch (error) {
			if (!(error instanceof ProviderError)) throw error;
			return {
				ok: false,
				message: { text: providerErrorMessage(error, this.strings), detailLine: providerErrorDetailLine(error, this.strings) },
			};
		} finally {
			this.busy = false;
		}
	}
}

/** A message at the top of a screen: its text, and for a provider failure the line telling what the provider answered. */
interface ScreenMessage {
	readonly text: string;
	readonly detailLine?: string;
}
