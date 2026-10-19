import { Notice, PluginSettingTab, Setting, requireApiVersion, type App, type Plugin, type SettingDefinitionItem } from "obsidian";
import type { ConnectionService } from "../engine/connection";
import type { DeviceIdentity } from "../engine/ports";
import { fill } from "./i18n/fill";
import type { Strings } from "./i18n/strings";

/** The tab's Connection row: what it says and what its button does. */
interface Row {
	readonly description: string;
	readonly button: string;
	readonly action: () => void;
}

/**
 * The plugin's settings tab: this device's Connection, with Connect or
 * Disconnect. It renders declaratively on Obsidian 1.13 and later
 * (`getSettingDefinitions`, also indexed for settings search) and through
 * `display` before that; both draw the same row.
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
	 */
	constructor(
		app: App,
		plugin: Plugin,
		private readonly service: ConnectionService,
		private readonly strings: Strings,
		private readonly openConnect: () => void,
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
		// A declarative action row runs when clicked, so it is named by what it does.
		const row = this.row();
		return [{ name: row.button, desc: row.description, action: row.action }];
	}

	override display(): void {
		this.draw();
	}

	/** Draws the row into the tab, as Obsidian before 1.13 shows it. */
	private draw(): void {
		this.containerEl.empty();
		const row = this.row();
		new Setting(this.containerEl)
			.setName(this.strings.settingsDropbox)
			.setDesc(row.description)
			.addButton((button) => button.setButtonText(row.button).onClick(row.action));
	}

	/** The Connection row for the Connection as read last. */
	private row(): Row {
		const { strings, device } = this;
		if (device === null) {
			return { description: strings.settingsNotConnected, button: strings.connect, action: this.openConnect };
		}
		return {
			description: fill(strings.settingsConnectedAs, { device: device.name }),
			button: strings.disconnect,
			action: () => void this.disconnect(),
		};
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
