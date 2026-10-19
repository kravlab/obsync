import { Notice, PluginSettingTab, Setting, requireApiVersion, type App, type Plugin, type SettingDefinitionItem } from "obsidian";
import type { ConnectionService } from "../engine/connection";
import type { DeviceIdentity } from "../engine/ports";
import type { ObsidianRequestLimitStore } from "../obsidian/request-limit-store";
import { parseRequestLimit } from "../engine/request-limit";
import { fill } from "./i18n/fill";
import type { Strings } from "./i18n/strings";

/** One row of the tab: its name, what it says and what its button does. */
interface Row {
	readonly name: string;
	readonly description: string;
	readonly button: string;
	readonly action: () => void;
}

/**
 * The plugin's settings tab: this device's Connection, with Connect or
 * Disconnect, "Sync now" while connected, and this device's per-request
 * limit. It renders declaratively on
 * Obsidian 1.13 and later (`getSettingDefinitions`, also indexed for
 * settings search) and through `display` before that; both draw the same
 * rows.
 *
 * The Connection is read asynchronously, so the tab shows the state it
 * read last; `reload` reads it again and redraws.
 */
export class ObsyncSettingTab extends PluginSettingTab {
	private device: DeviceIdentity | null = null;

	/**
	 * @param app the Obsidian app
	 * @param plugin the plugin owning the tab
	 * @param service reads and ends this device's Connection
	 * @param strings the UI strings in the user's language
	 * @param openConnect opens the connect window
	 * @param syncNow starts a sync of this device
	 * @param requestLimit keeps this device's Per-request limit
	 */
	constructor(
		app: App,
		plugin: Plugin,
		private readonly service: ConnectionService,
		private readonly strings: Strings,
		private readonly openConnect: () => void,
		private readonly syncNow: () => void,
		private readonly requestLimit: ObsidianRequestLimitStore,
	) {
		super(app, plugin);
	}

	/** Reads the Connection again and redraws the tab. */
	async reload(): Promise<void> {
		this.device = await this.service.currentDevice();
		if (requireApiVersion("1.13.0")) this.update();
		else this.draw();
	}

	override getSettingDefinitions(): SettingDefinitionItem[] {
		const { strings } = this;
		return [
			// A declarative action row runs when clicked, so it is named by what it does.
			...this.rows().map((row) => ({ name: row.button, desc: row.description, action: row.action })),
			{
				name: strings.settingsRequestLimit,
				desc: strings.settingsRequestLimitDescription,
				render: (setting) => this.drawRequestLimit(setting),
			},
		];
	}

	override display(): void {
		this.draw();
	}

	/** Draws the rows into the tab, as Obsidian before 1.13 shows them. */
	private draw(): void {
		this.containerEl.empty();
		for (const row of this.rows()) {
			new Setting(this.containerEl)
				.setName(row.name)
				.setDesc(row.description)
				.addButton((button) => button.setButtonText(row.button).onClick(row.action));
		}
		this.drawRequestLimit(new Setting(this.containerEl));
	}

	/**
	 * Draws the Per-request limit into `row`: a field holding the stored
	 * limit in MiB, saved as it is typed. While the typed value is not a
	 * limit, the stored one stays and the row says why, without a notice
	 * per keystroke.
	 */
	private drawRequestLimit(row: Setting): void {
		const { strings } = this;
		row.setName(strings.settingsRequestLimit).setDesc(strings.settingsRequestLimitDescription);
		row.addText((text) =>
			text.setValue(String(this.requestLimit.load().mebibytes)).onChange((typed) => {
				const limit = parseRequestLimit(typed);
				if (limit !== null) this.requestLimit.save(limit);
				row.setDesc(limit === null ? strings.settingsRequestLimitInvalid : strings.settingsRequestLimitDescription);
			}),
		);
	}

	/** The rows for the Connection as read last: Connect, or Disconnect and Sync now. */
	private rows(): Row[] {
		const { strings, device } = this;
		if (device === null) {
			return [
				{
					name: strings.settingsDropbox,
					description: strings.settingsNotConnected,
					button: strings.connect,
					action: this.openConnect,
				},
			];
		}
		return [
			{
				name: strings.settingsDropbox,
				description: fill(strings.settingsConnectedAs, { device: device.name }),
				button: strings.disconnect,
				action: () => void this.disconnect(),
			},
			{
				name: strings.syncNow,
				description: strings.settingsSyncNow,
				button: strings.syncNow,
				action: this.syncNow,
			},
		];
	}

	/**
	 * Disconnects this device and redraws the tab. When the login could not
	 * be revoked, the notice tells the user to revoke the app in Dropbox.
	 */
	private async disconnect(): Promise<void> {
		const outcome = await this.service.disconnect();
		new Notice(
			outcome.kind === "revokeFailed" ? this.strings.noticeDisconnectedRevokeFailed : this.strings.noticeDisconnected,
		);
		await this.reload();
	}
}
