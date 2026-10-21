import { Platform, Plugin, getLanguage, requestUrl } from "obsidian";
import { createConnectionService } from "./engine/connection";
import { createSyncEngine } from "./engine/engine";
import type { Scheduler } from "./engine/ports";
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
import { moveToConflict } from "./ui/conflict-commands";
import { conflictDecorations } from "./ui/conflict-decorations";
import { ConflictEditModal } from "./ui/conflict-edit-modal";
import { conflictReadingView } from "./ui/conflict-reading-view";
import { ConnectModal } from "./ui/connect-modal";
import { selectStrings, type Strings } from "./ui/i18n/strings";
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
		const schedule = new ObsidianScheduleStore(this.app);
		const deletionGuard = new ObsidianDeletionGuardStore(this.app);
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
			vault,
			deviceStore,
			secretStore,
			clock: dropbox.clock,
			scheduler,
			ui,
			schedule: () => schedule.load(),
			deletionGuard: () => deletionGuard.load(),
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
		this.addCommand({ id: "sync-now", name: strings.syncNow, callback: syncNow });
		this.addCommand({ id: "full-reconcile", name: strings.fullReconcile, callback: fullReconcile });
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
			() => {
				new ConnectModal(this.app, connection, strings, this.app.vault.getName(), () => {
					void settingTab.reload();
				}).open();
			},
			syncNow,
			requestLimit,
			schedule,
			deletionGuard,
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
