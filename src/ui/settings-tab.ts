import { Notice, PluginSettingTab, Setting, requireApiVersion, type App, type Plugin, type SettingDefinitionItem } from "obsidian";
import type { ConnectionService } from "../engine/connection";
import { parseMaxDeletedFiles, parseMaxDeletedPercent } from "../engine/deletion-guard";
import type { DeviceIdentity } from "../engine/ports";
import { parseRequestLimit } from "../engine/request-limit";
import { parseEditPause, parsePollInterval } from "../engine/sync-schedule";
import type { ObsidianDeletionGuardStore } from "../obsidian/deletion-guard-store";
import type { ObsidianRequestLimitStore } from "../obsidian/request-limit-store";
import type { ObsidianScheduleStore } from "../obsidian/schedule-store";
import { fill } from "./i18n/fill";
import type { Strings } from "./i18n/strings";

/** A number setting of the tab: what its row says and how a typed value is kept. */
interface NumberField {
	readonly name: string;
	readonly description: string;
	/** What the row says instead while the typed value is not one the setting takes. */
	readonly invalid: string;
	/** The stored value, as the field shows it. */
	readonly current: () => number;
	/** Stores the typed value if the setting takes it; returns whether it did. */
	readonly save: (typed: string) => boolean;
}

/**
 * Draws `field` into `row`: a text field holding the stored value, saved
 * as it is typed. While the typed value is not one the setting takes, the
 * stored one stays and the row says why, without a notice per keystroke.
 */
function drawNumberField(row: Setting, field: NumberField): void {
	row.setName(field.name).setDesc(field.description);
	row.addText((text) =>
		text.setValue(String(field.current())).onChange((typed) => {
			row.setDesc(field.save(typed) ? field.description : field.invalid);
		}),
	);
}

/** One row of the tab: its name, what it says and what its button does. */
interface Row {
	readonly name: string;
	readonly description: string;
	readonly button: string;
	readonly action: () => void;
}

/**
 * The plugin's settings tab: this device's Connection, with Connect or
 * Disconnect, "Sync now" while connected, and this device's number
 * settings: the post-edit pause, the polling interval, the per-request
 * limit and the Deletion guard thresholds. It renders declaratively on
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
	 * @param schedule keeps this device's post-edit pause and polling interval
	 * @param deletionGuard keeps this device's Deletion guard thresholds
	 */
	constructor(
		app: App,
		plugin: Plugin,
		private readonly service: ConnectionService,
		private readonly strings: Strings,
		private readonly openConnect: () => void,
		private readonly syncNow: () => void,
		private readonly requestLimit: ObsidianRequestLimitStore,
		private readonly schedule: ObsidianScheduleStore,
		private readonly deletionGuard: ObsidianDeletionGuardStore,
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
		return [
			// A declarative action row runs when clicked, so it is named by what it does.
			...this.rows().map((row) => ({ name: row.button, desc: row.description, action: row.action })),
			...this.numberFields().map((field) => ({
				name: field.name,
				desc: field.description,
				render: (setting: Setting) => drawNumberField(setting, field),
			})),
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
		for (const field of this.numberFields()) drawNumberField(new Setting(this.containerEl), field);
	}

	/**
	 * This device's number settings: the post-edit pause, the polling
	 * interval, the Per-request limit and the Deletion guard's N and P.
	 */
	private numberFields(): NumberField[] {
		const { strings, schedule, requestLimit, deletionGuard } = this;
		return [
			{
				name: strings.settingsEditPause,
				description: strings.settingsEditPauseDescription,
				invalid: strings.settingsEditPauseInvalid,
				current: () => schedule.load().editPause.seconds,
				save: (typed) => {
					const editPause = parseEditPause(typed);
					if (editPause !== null) schedule.save({ ...schedule.load(), editPause });
					return editPause !== null;
				},
			},
			{
				name: strings.settingsPollInterval,
				description: strings.settingsPollIntervalDescription,
				invalid: strings.settingsPollIntervalInvalid,
				current: () => schedule.load().pollInterval.seconds,
				save: (typed) => {
					const pollInterval = parsePollInterval(typed);
					if (pollInterval !== null) schedule.save({ ...schedule.load(), pollInterval });
					return pollInterval !== null;
				},
			},
			{
				name: strings.settingsRequestLimit,
				description: strings.settingsRequestLimitDescription,
				invalid: strings.settingsRequestLimitInvalid,
				current: () => requestLimit.load().mebibytes,
				save: (typed) => {
					const limit = parseRequestLimit(typed);
					if (limit !== null) requestLimit.save(limit);
					return limit !== null;
				},
			},
			{
				name: strings.settingsGuardFiles,
				description: strings.settingsGuardFilesDescription,
				invalid: strings.settingsGuardFilesInvalid,
				current: () => deletionGuard.load().maxFiles,
				save: (typed) => {
					const maxFiles = parseMaxDeletedFiles(typed);
					if (maxFiles !== null) deletionGuard.save({ ...deletionGuard.load(), maxFiles });
					return maxFiles !== null;
				},
			},
			{
				name: strings.settingsGuardPercent,
				description: strings.settingsGuardPercentDescription,
				invalid: strings.settingsGuardPercentInvalid,
				current: () => deletionGuard.load().maxPercent,
				save: (typed) => {
					const maxPercent = parseMaxDeletedPercent(typed);
					if (maxPercent !== null) deletionGuard.save({ ...deletionGuard.load(), maxPercent });
					return maxPercent !== null;
				},
			},
		];
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
