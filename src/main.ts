import { Plugin, getLanguage, requestUrl } from "obsidian";
import { createConnectionService } from "./engine/connection";
import { createSyncEngine } from "./engine/engine";
import type { Scheduler } from "./engine/ports";
import { ObsidianDeviceStore } from "./obsidian/device-store";
import { ObsidianLocalVault } from "./obsidian/local-vault";
import { ObsidianRequestLimitStore } from "./obsidian/request-limit-store";
import { ObsidianSecretStore } from "./obsidian/secret-store";
import { DROPBOX_APP_KEY } from "./providers/dropbox/app-key";
import { createDropboxConnectStep } from "./providers/dropbox/connect-step";
import type { DropboxOptions } from "./providers/dropbox/options";
import { createDropboxConnector } from "./providers/dropbox/provider";
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
	 * the connection service and the sync engine over Dropbox and this
	 * device's vault and stores, adds the status entry point, the "Sync now"
	 * command and the settings tab, then shows the state of this device's
	 * Connection. Strings follow Obsidian's language as read at load.
	 */
	override async onload(): Promise<void> {
		const strings = selectStrings(getLanguage());
		const requestLimit = new ObsidianRequestLimitStore(this.app);
		const scheduler = this.scheduler();
		const dropbox: DropboxOptions = {
			appKey: DROPBOX_APP_KEY,
			http: requestUrl,
			clock: { now: () => Date.now() },
			transfers: {
				requestLimit: () => requestLimit.load(),
				// A pause still pending at unload is cancelled with the plugin.
				wait: (ms) =>
					new Promise<void>((resolve) => {
						scheduler.schedule(ms, resolve);
					}),
			},
		};
		const deviceStore = new ObsidianDeviceStore(this.app);
		const secretStore = new ObsidianSecretStore(this.app);
		const ui = new StatusIndicator(this, strings);
		const connection = createConnectionService({
			connectStep: createDropboxConnectStep(dropbox),
			deviceStore,
			secretStore,
			ui,
			newDeviceId: () => crypto.randomUUID(),
		});
		const engine = createSyncEngine({
			providers: createDropboxConnector(dropbox),
			vault: new ObsidianLocalVault(this.app),
			deviceStore,
			secretStore,
			clock: dropbox.clock,
			scheduler,
			ui,
		});
		// The engine shows Sync failed itself; an error reaching here is a
		// bug, logged for the bug report.
		const syncNow = (): void => {
			engine.sync().catch((error: unknown) => console.error("obsync: sync failed", error));
		};
		this.addCommand({ id: "sync-now", name: strings.syncNow, callback: syncNow });
		const settingTab = new ObsyncSettingTab(
			this.app,
			this,
			connection,
			strings,
			() => {
				new ConnectModal(this.app, connection, strings, this.app.vault.getName(), () => {
					void settingTab.reload();
				}).open();
			},
			syncNow,
			requestLimit,
		);
		this.addSettingTab(settingTab);
		await connection.showStatus();
		await settingTab.reload();
	}

	/**
	 * The engine's Scheduler over the window's timers. A task still pending
	 * when the plugin unloads is cancelled with it.
	 */
	private scheduler(): Scheduler {
		return {
			schedule: (delayMs, task) => {
				const id = window.setTimeout(task, delayMs);
				const cancel = (): void => window.clearTimeout(id);
				this.register(cancel);
				return cancel;
			},
		};
	}
}
