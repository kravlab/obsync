import { Notice, PluginSettingTab, Setting, requireApiVersion, type App, type Plugin, type SettingDefinitionItem } from "obsidian";
import { CONFIGURATION_CATEGORIES, type ConfigurationCategory } from "../engine/configuration";
import type { ConnectionService } from "../engine/connection";
import { parseMaxDeletedFiles, parseMaxDeletedPercent } from "../engine/deletion-guard";
import type { DeviceIdentity } from "../engine/ports";
import type { DeviceRecord, RemoteSettings } from "../engine/remote-metadata";
import { parseRequestLimit } from "../engine/request-limit";
import {
	parseIgnoreList,
	parseSizeCeiling,
	parseTextExtensions,
	sameSettings,
	sizeCeilingMebibytes,
} from "../engine/settings-change";
import { parseEditPause, parsePollInterval } from "../engine/sync-schedule";
import type { ObsidianConfigurationCategoriesStore } from "../obsidian/configuration-categories-store";
import type { ObsidianDeletionGuardStore } from "../obsidian/deletion-guard-store";
import type { ObsidianRequestLimitStore } from "../obsidian/request-limit-store";
import type { ObsidianScheduleStore } from "../obsidian/schedule-store";
import { ConfirmModal } from "./confirm-modal";
import { fill } from "./i18n/fill";
import type { Strings } from "./i18n/strings";
import { namePolicyText } from "./shared-settings-text";

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

/** An on/off setting of the tab: what its row says and how a change is kept. */
interface ToggleField {
	readonly name: string;
	readonly description: string;
	/** The stored value, as the toggle shows it. */
	readonly current: () => boolean;
	/** Stores the value the toggle was switched to. */
	readonly save: (on: boolean) => void;
}

/** Draws `field` into `row`: a toggle showing the stored value, saved as it is switched. */
function drawToggleField(row: Setting, field: ToggleField): void {
	row.setName(field.name).setDesc(field.description);
	row.addToggle((toggle) => toggle.setValue(field.current()).onChange(field.save));
}

/** A row of the tab that draws its own controls: what it says, and how it draws them. */
interface CustomField {
	readonly name: string;
	readonly description: string;
	/** Adds the row's controls to `row`, which already says what the field does. */
	readonly render: (row: Setting) => void;
}

/** Draws `field` into `row`. */
function drawCustomField(row: Setting, field: CustomField): void {
	row.setName(field.name).setDesc(field.description);
	field.render(row);
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
 * Disconnect, "Sync now" and the device name while connected, a row
 * opening the help, this device's number settings: the post-edit pause, the polling interval,
 * the per-request limit and the Deletion guard thresholds, and, under
 * their own headings, this device's configuration categories and, while
 * connected, the shared Remote settings with "Apply to all devices" and
 * the other devices, each to forget. It renders declaratively on
 * Obsidian 1.13 and later (`getSettingDefinitions`, also indexed for
 * settings search) and through `display` before that; both draw the same
 * rows.
 *
 * The Connection and the shared settings are read asynchronously, so the
 * tab shows the state it read last; `reload` reads them again and redraws.
 * The other devices take a full listing of the Remote, so they are read
 * only when the user asks for them.
 */
export class ObsyncSettingTab extends PluginSettingTab {
	private device: DeviceIdentity | null = null;
	/** The shared settings as edited in the tab, starting from those read last; null before a sync read them. */
	private draft: RemoteSettings | null = null;
	/** The shared settings the draft was edited from: those read last, or those applied last. */
	private shown: RemoteSettings | null = null;
	/** The device name as typed. */
	private typedName = "";
	/** The other devices as read last: undefined until the user asks for them, null when they could not be read. */
	private others: readonly DeviceRecord[] | null | undefined = undefined;

	/**
	 * @param app the Obsidian app
	 * @param plugin the plugin owning the tab
	 * @param service reads and ends this device's Connection
	 * @param strings the UI strings in the user's language
	 * @param openConnect opens the connect window
	 * @param syncNow starts a sync of this device
	 * @param changeSettings brings the shared Remote settings to the wanted ones, edited from the base ones, settling once its sync is done
	 * @param openHelp opens the help
	 * @param requestLimit keeps this device's Per-request limit
	 * @param schedule keeps this device's post-edit pause and polling interval
	 * @param deletionGuard keeps this device's Deletion guard thresholds
	 * @param categories keeps this device's configuration categories
	 */
	constructor(
		app: App,
		plugin: Plugin,
		private readonly service: ConnectionService,
		private readonly strings: Strings,
		private readonly openConnect: () => void,
		private readonly syncNow: () => void,
		private readonly changeSettings: (base: RemoteSettings, wanted: RemoteSettings) => Promise<void>,
		private readonly openHelp: () => void,
		private readonly requestLimit: ObsidianRequestLimitStore,
		private readonly schedule: ObsidianScheduleStore,
		private readonly deletionGuard: ObsidianDeletionGuardStore,
		private readonly categories: ObsidianConfigurationCategoriesStore,
	) {
		super(app, plugin);
	}

	/**
	 * Reads the Connection and the shared settings again, dropping edits not
	 * applied, and redraws the tab. Without a Connection, the other devices
	 * read before are forgotten.
	 */
	async reload(): Promise<void> {
		this.device = await this.service.currentDevice();
		this.shown = this.device === null ? null : await this.service.sharedSettings();
		this.draft = this.shown;
		this.typedName = this.device?.name ?? "";
		if (this.device === null) this.others = undefined;
		this.redraw();
	}

	/**
	 * After a sync: shows the shared settings it brought, unless the user is
	 * editing them, so edits not applied yet are kept. Draws the tab again
	 * only when they changed.
	 */
	async refreshShared(): Promise<void> {
		if (this.device === null) return;
		const { shown, draft } = this;
		const editing = shown !== null && draft !== null && !sameSettings(shown, draft);
		const read = await this.service.sharedSettings();
		if (editing || read === null || (shown !== null && sameSettings(read, shown))) return;
		this.shown = read;
		this.draft = read;
		this.redraw();
	}

	/** Draws the tab again from what it holds. */
	private redraw(): void {
		if (requireApiVersion("1.13.0")) this.update();
		else this.draw();
	}

	override getSettingDefinitions(): SettingDefinitionItem[] {
		/** `field` as a declarative row. */
		const custom = (field: CustomField) => ({
			name: field.name,
			desc: field.description,
			render: (setting: Setting) => drawCustomField(setting, field),
		});
		return [
			// A declarative action row runs when clicked, so it is named by what it does.
			...this.rows().map((row) => ({ name: row.button, desc: row.description, action: row.action })),
			...this.deviceNameFields().map(custom),
			...this.numberFields().map((field) => ({
				name: field.name,
				desc: field.description,
				render: (setting: Setting) => drawNumberField(setting, field),
			})),
			{
				type: "group",
				heading: this.strings.settingsConfigurationHeading,
				items: this.categoryFields().map((field) => ({
					name: field.name,
					desc: field.description,
					render: (setting: Setting) => drawToggleField(setting, field),
				})),
			},
			...(this.device === null
				? []
				: [
						{ type: "group" as const, heading: this.strings.settingsSharedHeading, items: this.sharedFields().map(custom) },
						{ type: "group" as const, heading: this.strings.settingsDevicesHeading, items: this.otherDeviceFields().map(custom) },
					]),
		];
	}

	/**
	 * Draws the tab when it opens, on Obsidian before 1.13, then reads it
	 * again, so it shows what syncs brought since. Obsidian 1.13 and later
	 * do not call it; there the tab follows each sync (`refreshShared`).
	 */
	override display(): void {
		this.draw();
		this.reload().catch((error: unknown) => console.error("obsync: reading the settings failed", error));
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
		for (const field of this.deviceNameFields()) drawCustomField(new Setting(this.containerEl), field);
		for (const field of this.numberFields()) drawNumberField(new Setting(this.containerEl), field);
		new Setting(this.containerEl).setName(this.strings.settingsConfigurationHeading).setHeading();
		for (const field of this.categoryFields()) drawToggleField(new Setting(this.containerEl), field);
		if (this.device === null) return;
		new Setting(this.containerEl).setName(this.strings.settingsSharedHeading).setHeading();
		for (const field of this.sharedFields()) drawCustomField(new Setting(this.containerEl), field);
		new Setting(this.containerEl).setName(this.strings.settingsDevicesHeading).setHeading();
		for (const field of this.otherDeviceFields()) drawCustomField(new Setting(this.containerEl), field);
	}

	/** This device's name, to rename it, while connected. */
	private deviceNameFields(): CustomField[] {
		const { strings } = this;
		if (this.device === null) return [];
		return [
			{
				name: strings.deviceName,
				description: strings.deviceNameDescription,
				render: (row) => {
					row.addText((text) => text.setValue(this.typedName).onChange((typed) => (this.typedName = typed)));
					row.addButton((button) => button.setButtonText(strings.rename).onClick(() => this.rename()));
				},
			},
		];
	}

	/**
	 * Renames this device to the typed name and reads the tab again; a
	 * blank name is refused with a notice.
	 */
	private rename(): void {
		this.service
			.renameDevice(this.typedName)
			.then((outcome) => {
				if (outcome.kind === "emptyName") new Notice(this.strings.deviceNameInvalid);
				return this.reload();
			})
			.catch((error: unknown) => {
				// A bug: the user is told, and the console keeps it for the bug report.
				console.error("obsync: renaming the device failed", error);
				new Notice(this.strings.noticeRenameFailed);
			});
	}

	/**
	 * The shared Remote settings as edited, and "Apply to all devices";
	 * before a sync read them, a row asking for one. A size limit typed
	 * that is not one keeps the one before and says why.
	 */
	private sharedFields(): CustomField[] {
		const { strings, draft } = this;
		if (draft === null) return [{ name: strings.settingsSharedUnknown, description: "", render: () => undefined }];
		/** Takes `change` into the settings as edited. */
		const edit = (change: Partial<RemoteSettings>): void => {
			if (this.draft !== null) this.draft = { ...this.draft, ...change };
		};
		return [
			{
				name: strings.settingsNamePolicy,
				description: strings.settingsNamePolicyDescription,
				render: (row) => {
					row.addDropdown((dropdown) =>
						dropdown
							.addOption("skipAndReport", namePolicyText("skipAndReport", strings))
							.addOption("encodeReversibly", namePolicyText("encodeReversibly", strings))
							.setValue(draft.namePolicy)
							.onChange((value) => edit({ namePolicy: value === "encodeReversibly" ? value : "skipAndReport" })),
					);
				},
			},
			{
				name: strings.settingsTextExtensions,
				description: strings.settingsTextExtensionsDescription,
				render: (row) => {
					row.addText((text) =>
						text
							.setValue(draft.textExtensions.join(", "))
							.onChange((typed) => edit({ textExtensions: parseTextExtensions(typed) })),
					);
				},
			},
			{
				name: strings.settingsIgnoreList,
				description: strings.settingsIgnoreListDescription,
				render: (row) => {
					row.addTextArea((text) =>
						text.setValue(draft.ignoreList.join("\n")).onChange((typed) => edit({ ignoreList: parseIgnoreList(typed) })),
					);
				},
			},
			{
				name: strings.settingsSizeCeiling,
				description: strings.settingsSizeCeilingDescription,
				render: (row) => {
					row.addText((text) =>
						text.setValue(String(sizeCeilingMebibytes(draft))).onChange((typed) => {
							const sizeCeilingBytes = parseSizeCeiling(typed);
							if (sizeCeilingBytes !== null) edit({ sizeCeilingBytes });
							row.setDesc(sizeCeilingBytes === null ? strings.settingsSizeCeilingInvalid : strings.settingsSizeCeilingDescription);
						}),
					);
				},
			},
			{
				name: strings.settingsApplyShared,
				description: strings.settingsApplySharedDescription,
				render: (row) => {
					row.addButton((button) =>
						button
							.setButtonText(strings.settingsApplyShared)
							.setCta()
							.onClick(() => this.applyShared()),
					);
				},
			},
		];
	}

	/**
	 * Brings the shared settings as edited to every device, then reads the
	 * tab again. A change applied before that sync is done is made from
	 * these, as the tab shows them.
	 */
	private applyShared(): void {
		const { shown, draft } = this;
		if (shown === null || draft === null) return;
		this.shown = draft;
		this.changeSettings(shown, draft)
			.then(() => this.reload())
			.catch((error: unknown) => {
				// A bug: the user is told, and the console keeps it for the bug report.
				console.error("obsync: applying the shared settings failed", error);
				new Notice(this.strings.noticeApplyFailed);
			});
	}

	/**
	 * The other devices: a button reading them until the user asked, one
	 * row each with Forget once read, or a row saying there are none or
	 * that they could not be read, with the button to try again.
	 */
	private otherDeviceFields(): CustomField[] {
		const { strings, others } = this;
		const showButton = (row: Setting): void => {
			row.addButton((button) => button.setButtonText(strings.showDevices).onClick(() => this.loadOthers()));
		};
		if (others === undefined) return [{ name: strings.showDevices, description: strings.settingsDeviceDescription, render: showButton }];
		if (others === null) return [{ name: strings.settingsDevicesUnavailable, description: "", render: showButton }];
		if (others.length === 0) return [{ name: strings.settingsNoOtherDevices, description: "", render: () => undefined }];
		return others.map((record) => ({
			name: record.device.name,
			description: strings.settingsDeviceDescription,
			render: (row) => {
				row.addButton((button) => button.setButtonText(strings.forgetDevice).onClick(() => this.forget(record)));
			},
		}));
	}

	/** Reads the other devices from the Remote and redraws the tab; a failure, e.g. offline, is shown in their place. */
	private loadOthers(): void {
		this.service
			.otherDevices()
			.then((records) => (this.others = records))
			.catch(() => (this.others = null))
			.finally(() => this.redraw());
	}

	/**
	 * Forgets `record` once the user confirms, tells how it went, and reads
	 * the other devices again.
	 */
	private forget(record: DeviceRecord): void {
		const { strings } = this;
		const device = record.device.name;
		new ConfirmModal(this.app, strings, {
			title: fill(strings.forgetDeviceTitle, { device }),
			text: strings.forgetDeviceText,
			confirm: strings.forgetDevice,
		})
			.ask()
			.then(async (confirmed) => {
				if (confirmed === null) return;
				const outcome = await this.service.forgetDevice(record);
				new Notice(fill(outcome.kind === "forgotten" ? strings.noticeDeviceForgotten : strings.noticeDeviceInUse, { device }));
				this.loadOthers();
			})
			.catch((error: unknown) => {
				// Offline, or a bug: the user is told, and the console keeps it for the bug report.
				console.error("obsync: forgetting a device failed", error);
				new Notice(strings.noticeForgetFailed);
			});
	}

	/**
	 * This device's configuration categories, Plugins with the secrets
	 * warning. Turning one on syncs at once, which brings its files
	 * together as a union, a First sync for them; turning one off takes
	 * them out of the next sync.
	 */
	private categoryFields(): ToggleField[] {
		const { strings, categories } = this;
		const text: Record<ConfigurationCategory, { readonly name: string; readonly description: string }> = {
			settingsAndHotkeys: { name: strings.settingsCategorySettings, description: strings.settingsCategorySettingsDescription },
			themesAndSnippets: { name: strings.settingsCategoryThemes, description: strings.settingsCategoryThemesDescription },
			plugins: { name: strings.settingsCategoryPlugins, description: strings.settingsCategoryPluginsDescription },
		};
		return CONFIGURATION_CATEGORIES.map((category) => ({
			...text[category],
			current: () => categories.load()[category],
			save: (on) => {
				categories.save({ ...categories.load(), [category]: on });
				if (on) this.syncNow();
			},
		}));
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

	/** The rows for the Connection as read last: Connect, or Disconnect and Sync now; then Help. */
	private rows(): Row[] {
		const { strings } = this;
		const help: Row = {
			name: strings.settingsHelp,
			description: strings.settingsHelpDescription,
			button: strings.openHelp,
			action: this.openHelp,
		};
		return [...this.connectionRows(), help];
	}

	/** The rows for the Connection as read last: Connect, or Disconnect and Sync now. */
	private connectionRows(): Row[] {
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
				action: () => {
					this.disconnect().catch((error: unknown) => {
						// A bug: the user is told, and the console keeps it for the bug report.
						console.error("obsync: disconnecting failed", error);
						new Notice(this.strings.noticeDisconnectFailed);
					});
				},
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
	 * Rejects on an unexpected error, which the row's action tells.
	 */
	private async disconnect(): Promise<void> {
		const outcome = await this.service.disconnect();
		new Notice(
			outcome.kind === "revokeFailed" ? this.strings.noticeDisconnectedRevokeFailed : this.strings.noticeDisconnected,
		);
		await this.reload();
	}
}
