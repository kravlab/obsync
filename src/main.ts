import { Plugin, getLanguage, requestUrl } from "obsidian";
import { createConnectionService } from "./engine/connection";
import { ObsidianDeviceStore } from "./obsidian/device-store";
import { ObsidianSecretStore } from "./obsidian/secret-store";
import { DROPBOX_APP_KEY } from "./providers/dropbox/app-key";
import { createDropboxConnectStep } from "./providers/dropbox/connect-step";
import { ConnectModal } from "./ui/connect-modal";
import { selectStrings } from "./ui/i18n/strings";
import { ObsyncSettingTab } from "./ui/settings-tab";
import { StatusIndicator } from "./ui/status-indicator";

/**
 * The plugin shell: Obsidian's entry point. It owns only wiring and UI; all
 * sync logic lives in the engine (src/engine), which never imports Obsidian.
 */
export default class ObsyncPlugin extends Plugin {
	/**
	 * Called by Obsidian when the plugin is enabled or the app starts. Builds
	 * the connection service over Dropbox and this device's stores, adds the
	 * status entry point and the settings tab, then shows the state of this
	 * device's Connection. Strings follow Obsidian's language as read at load.
	 *
	 * The whole sync engine joins once there is syncing to run.
	 */
	override async onload(): Promise<void> {
		const strings = selectStrings(getLanguage());
		const connection = createConnectionService({
			connectStep: createDropboxConnectStep({
				appKey: DROPBOX_APP_KEY,
				http: requestUrl,
				clock: { now: () => Date.now() },
			}),
			deviceStore: new ObsidianDeviceStore(this.app),
			secretStore: new ObsidianSecretStore(this.app),
			ui: new StatusIndicator(this, strings),
			newDeviceId: () => crypto.randomUUID(),
		});
		const settingTab = new ObsyncSettingTab(this.app, this, connection, strings, () => {
			new ConnectModal(this.app, connection, strings, this.app.vault.getName(), () => {
				void settingTab.reload();
			}).open();
		});
		this.addSettingTab(settingTab);
		await connection.showStatus();
		await settingTab.reload();
	}
}
