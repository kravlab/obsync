import { MarkdownView, Notice, Platform, Plugin, apiVersion, getLanguage, requestUrl } from "obsidian";
import { withActivityLog } from "./engine/activity-log";
import { createConnectionService } from "./engine/connection";
import { createSyncEngine } from "./engine/engine";
import type { ConfigurationConflictStore, Scheduler } from "./engine/ports";
import { ObsidianActivityStore } from "./obsidian/activity-store";
import { ObsidianConfigurationCategoriesStore } from "./obsidian/configuration-categories-store";
import { ObsidianConfigurationConflicts } from "./obsidian/configuration-conflict-store";
import { ObsidianDeletionGuardStore } from "./obsidian/deletion-guard-store";
import { ObsidianDeviceStore } from "./obsidian/device-store";
import { ObsidianLocalVault } from "./obsidian/local-vault";
import { ObsidianRequestLimitStore } from "./obsidian/request-limit-store";
import { ObsidianScheduleStore } from "./obsidian/schedule-store";
import { ObsidianSecretStore } from "./obsidian/secret-store";
import { DROPBOX_APP_KEY } from "./providers/dropbox/app-key";
import { createDropboxConnectStep } from "./providers/dropbox/connect-step";
import type { DropboxOptions } from "./providers/dropbox/options";
import { createDropboxConnector } from "./providers/dropbox/provider";
import { bugReport } from "./ui/bug-report";
import { moveToConflict, moveToFirstConflict } from "./ui/conflict-commands";
import { conflictDecorations } from "./ui/conflict-decorations";
import { ConflictEditModal } from "./ui/conflict-edit-modal";
import { conflictReadingView } from "./ui/conflict-reading-view";
import { ConnectModal } from "./ui/connect-modal";
import { defaultDeviceName } from "./ui/device-name";
import { fill } from "./ui/i18n/fill";
import { selectStrings, type Strings } from "./ui/i18n/strings";
import { RestoreConfigurationModal } from "./ui/restore-configuration-modal";
import { ObsyncSettingTab } from "./ui/settings-tab";
import { StatusIndicator } from "./ui/status-indicator";
import { SyncWindow, type ShownSyncSource, type SyncTab } from "./ui/sync-window";

/**
 * The plugin shell: Obsidian's entry point. It owns only wiring and UI; all
 * sync logic lives in the engine (src/engine), which never imports Obsidian.
 */
export default class ObsyncPlugin extends Plugin {
	/**
	 * Called by Obsidian when the plugin is enabled or the app starts. Builds
	 * the connection service and the sync engine over Dropbox and this
	 * device's vault and stores, with the activity log in front of the UI,
	 * adds the status entry point and the Sync window it opens, the
	 * commands (open the window or one of its tabs, Reconnect while paused
	 * for it, Sync now, Full reconcile, Restore local configuration) and the
	 * settings tab, then shows the state of this device's Connection.
	 * Strings follow Obsidian's language as read at load.
	 */
	override async onload(): Promise<void> {
		const strings = selectStrings(getLanguage());
		const requestLimit = new ObsidianRequestLimitStore(this.app);
		const schedule = new ObsidianScheduleStore(this.app);
		const deletionGuard = new ObsidianDeletionGuardStore(this.app);
		const categories = new ObsidianConfigurationCategoriesStore(this.app);
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
		this.register(() => deviceStore.close());
		const vault = new ObsidianLocalVault(this.app, this);
		// Typing tells the engine which open note to leave alone until the post-edit pause has passed.
		this.registerEvent(
			this.app.workspace.on("editor-change", (_editor, info) => {
				if (info.file) vault.noteTyped(info.file.path);
			}),
		);
		const secretStore = new ObsidianSecretStore(this.app);
		// Obsidian sets it for every plugin it loads; the typings leave it optional for manifests of plugins not loaded.
		const pluginDir = this.manifest.dir;
		if (pluginDir === undefined) throw new Error("obsync: Obsidian gave no folder for this plugin");
		const configurationConflicts = new ObsidianConfigurationConflicts(
			this.app.vault.adapter,
			`${pluginDir}/configuration-conflicts`,
			() => crypto.randomUUID(),
		);
		const indicator = new StatusIndicator(this, strings, () => openSyncWindow("conflicts"));
		// Every notice and status goes through the activity log on its way to the indicator.
		const ui = withActivityLog(indicator, new ObsidianActivityStore(this.app), dropbox.clock);
		const connection = createConnectionService({
			connectStep: createDropboxConnectStep(dropbox),
			deviceStore,
			secretStore,
			ui,
			newDeviceId: () => crypto.randomUUID(),
			clock: dropbox.clock,
		});
		const engine = createSyncEngine({
			providers: createDropboxConnector(dropbox),
			vault,
			deviceStore,
			secretStore,
			configurationConflicts,
			clock: dropbox.clock,
			scheduler,
			ui,
			schedule: () => schedule.load(),
			deletionGuard: () => deletionGuard.load(),
			configurationCategories: () => categories.load(),
			pluginDir,
			pluginId: this.manifest.id,
			newDeviceId: () => crypto.randomUUID(),
		});
		// The engine shows Sync failed itself; an error reaching here is a
		// bug, logged for the bug report.
		const syncNow = (): void => {
			engine.sync().catch((error: unknown) => console.error("obsync: sync failed", error));
		};
		// Visibility and network events sync on their own, so they do not lift a Deletion guard hold.
		const syncAutomatically = (): void => {
			engine.sync("automatic").catch((error: unknown) => console.error("obsync: sync failed", error));
		};
		const fullReconcile = (): void => {
			engine.reconcile().catch((error: unknown) => console.error("obsync: reconcile failed", error));
		};
		const openConnect = (): void => {
			new ConnectModal(this.app, connection, strings, this.app.vault.getName(), (how) => {
				void settingTab.reload();
				// A login again ends a pause for Reconnect needed; syncing goes on at once.
				if (how === "reconnected") syncNow();
			}).open();
		};
		// One Sync window at a time, closed with the plugin so its buttons never reach an unloaded engine.
		let syncWindow: SyncWindow | undefined;
		this.register(() => syncWindow?.close());
		const openSyncWindow = (tab: SyncTab): void => {
			syncWindow?.close();
			syncWindow = new SyncWindow(
				this.app,
				strings,
				indicator,
				{
					syncNow,
					connect: openConnect,
					openFile: (path, atFirstConflict) => {
						this.openVaultFile(path, atFirstConflict, strings).catch((error: unknown) =>
							console.error("obsync: opening a file failed", error),
						);
					},
					restore: (id) => {
						engine.restoreConfiguration(id).catch((error: unknown) => console.error("obsync: restore failed", error));
					},
					copyBugReport: () => {
						this.copyBugReport(indicator, strings).catch((error: unknown) => {
							// The clipboard can refuse, e.g. without focus or permission: the user is told, not left waiting.
							console.error("obsync: copying the bug report failed", error);
							new Notice(strings.bugReportNotCopied);
						});
					},
				},
				tab,
			);
			syncWindow.open();
		};
		this.addCommand({ id: "open-sync-window", name: strings.openSyncWindow, callback: () => openSyncWindow("conflicts") });
		this.addCommand({ id: "show-conflicts", name: strings.showConflicts, callback: () => openSyncWindow("conflicts") });
		this.addCommand({ id: "show-skipped", name: strings.showSkipped, callback: () => openSyncWindow("skipped") });
		this.addCommand({ id: "show-activity", name: strings.showActivity, callback: () => openSyncWindow("activity") });
		this.addCommand({
			id: "reconnect",
			name: strings.reconnectCommand,
			// Offered only while sync is paused for a new login.
			checkCallback: (checking) => {
				if (indicator.shown().status.state !== "reconnectNeeded") return false;
				if (!checking) openConnect();
				return true;
			},
		});
		this.addCommand({ id: "sync-now", name: strings.syncNow, callback: syncNow });
		this.addCommand({ id: "full-reconcile", name: strings.fullReconcile, callback: fullReconcile });
		this.addCommand({
			id: "restore-local-configuration",
			name: strings.restoreConfiguration,
			callback: () => {
				this.openRestoreConfiguration(configurationConflicts, strings, (id) => engine.restoreConfiguration(id)).catch(
					(error: unknown) => console.error("obsync: restore list failed", error),
				);
			},
		});
		this.addConflictResolution(strings);
		this.app.workspace.onLayoutReady(() => {
			// Nothing syncs before the vault's files are all loaded.
			const started = engine.start();
			this.register(started.stop);
			started.opened.catch((error: unknown) => console.error("obsync: start failed", error));
			// The main workspace's own document and window, not whichever window has focus.
			const mainDocument = this.app.workspace.containerEl.ownerDocument;
			// Only `visible` is acted on; `hidden` is not relied on, since the OS
			// may suspend the app before a sync could finish.
			this.registerDomEvent(mainDocument, "visibilitychange", () => {
				if (mainDocument.visibilityState === "visible") syncAutomatically();
			});
			const mainWindow = mainDocument.defaultView;
			if (mainWindow !== null) this.registerDomEvent(mainWindow, "online", () => syncAutomatically());
		});
		const settingTab = new ObsyncSettingTab(
			this.app,
			this,
			connection,
			strings,
			openConnect,
			syncNow,
			requestLimit,
			schedule,
			deletionGuard,
			categories,
		);
		this.addSettingTab(settingTab);
		await connection.showStatus();
		await settingTab.reload();
	}

	/**
	 * Adds the ways to resolve Conflict blocks (spec, "Architecture and
	 * modules"): the action rows in the editor, the panels in reading view,
	 * and the "Next conflict" and "Previous conflict" commands.
	 */
	private addConflictResolution(strings: Strings): void {
		this.registerEditorExtension(
			conflictDecorations({
				strings,
				isPhone: Platform.isPhone,
				editBlock: (block, apply) => new ConflictEditModal(this.app, strings, block, apply).open(),
			}),
		);
		this.registerMarkdownPostProcessor(conflictReadingView(this.app, strings));
		this.addCommand({
			id: "next-conflict",
			name: strings.nextConflict,
			editorCallback: (editor) => moveToConflict(editor, "next", strings),
		});
		this.addCommand({
			id: "previous-conflict",
			name: strings.previousConflict,
			editorCallback: (editor) => moveToConflict(editor, "previous", strings),
		});
	}

	/**
	 * Opens the list of local configuration versions kept on configuration
	 * conflicts; picking one restores it with `restore`. With none kept, a
	 * notice says so instead. A failed restore is a bug, logged for the bug
	 * report.
	 */
	private async openRestoreConfiguration(
		store: ConfigurationConflictStore,
		strings: Strings,
		restore: (id: string) => Promise<void>,
	): Promise<void> {
		const kept = await store.list();
		if (kept.length === 0) {
			new Notice(strings.noKeptConfiguration);
			return;
		}
		new RestoreConfigurationModal(this.app, strings, kept, (version) => {
			restore(version.id).catch((error: unknown) => console.error("obsync: restore failed", error));
		}).open();
	}

	/**
	 * Opens the vault file at `path` in the current tab, with the cursor on
	 * its first Conflict block when `atFirstConflict` and it opens in an
	 * editor. A file gone since the list was shown gets a notice instead.
	 */
	private async openVaultFile(path: string, atFirstConflict: boolean, strings: Strings): Promise<void> {
		const file = this.app.vault.getFileByPath(path);
		if (file === null) {
			new Notice(fill(strings.fileGone, { file: path }));
			return;
		}
		const leaf = this.app.workspace.getLeaf(false);
		await leaf.openFile(file);
		if (atFirstConflict && leaf.view instanceof MarkdownView) moveToFirstConflict(leaf.view.editor);
	}

	/**
	 * Copies the bug report of what `source` shows to the clipboard, with
	 * this plugin's and Obsidian's versions and the platform, in English,
	 * and says so in a notice. Rejects when the clipboard refuses the write.
	 */
	private async copyBugReport(source: ShownSyncSource, strings: Strings): Promise<void> {
		const report = bugReport({
			pluginVersion: this.manifest.version,
			obsidianVersion: apiVersion,
			platform: defaultDeviceName(selectStrings("en")),
			...source.shown(),
		});
		await navigator.clipboard.writeText(report);
		new Notice(strings.bugReportCopied);
	}

	/**
	 * The engine's Scheduler over the window's timers. A task still pending
	 * when the plugin unloads is cancelled with it; one that ran or was
	 * cancelled is forgotten, so timers do not pile up.
	 */
	private scheduler(): Scheduler {
		const pending = new Set<number>();
		this.register(() => {
			for (const id of pending) window.clearTimeout(id);
			pending.clear();
		});
		return {
			schedule: (delayMs, task) => {
				const id = window.setTimeout(() => {
					pending.delete(id);
					task();
				}, delayMs);
				pending.add(id);
				return () => {
					pending.delete(id);
					window.clearTimeout(id);
				};
			},
		};
	}
}
