import { Notice, Platform, setTooltip, type Plugin } from "obsidian";
import type { DeletionAnswer, DeletionPrompt } from "../engine/deletion-guard";
import type { FirstSyncAnswer, FirstSyncPreview } from "../engine/first-sync";
import type { SyncNotice } from "../engine/notices";
import type { UiPort } from "../engine/ports";
import type { SyncStatus } from "../engine/status";
import type { Strings } from "./i18n/strings";
import { DeletionGuardModal } from "./deletion-guard-modal";
import { FirstSyncModal } from "./first-sync-modal";
import { noticeText } from "./notice-text";
import { statusLabel } from "./status-label";

/**
 * Shows the sync status where the platform has room for it: a status bar
 * item on desktop, a ribbon icon on mobile, which has no status bar. A
 * click on either shows the status in a notice until the Sync window
 * exists. It is the shell's UI port: the engine reports each status here,
 * and each sync notice, shown as an Obsidian notice, and asks the Deletion
 * guard's question through it.
 */
export class StatusIndicator implements UiPort {
	private label: string;
	/** Deletion guard prompts and First sync previews open now; the plugin's unload closes them, which answers null. */
	private readonly prompts = new Set<DeletionGuardModal | FirstSyncModal>();
	/** The status bar item (desktop) or ribbon icon (mobile). */
	private readonly element: HTMLElement;

	/**
	 * Adds the entry point to `plugin`, which removes it on unload.
	 *
	 * @param plugin the plugin owning the entry point and its events
	 * @param strings the UI strings in the user's language
	 */
	constructor(
		private readonly plugin: Plugin,
		private readonly strings: Strings,
	) {
		this.label = statusLabel({ state: "notConnected" }, strings);
		// A prompt left open would let a sync of the unloaded plugin delete files later.
		plugin.register(() => {
			for (const prompt of this.prompts) prompt.close();
		});
		const showState = (): void => {
			new Notice(this.label);
		};

		if (Platform.isMobile) {
			this.element = plugin.addRibbonIcon("cloud-off", this.label, showState);
		} else {
			// A status bar item is a plain div, so it is made a focusable
			// button that Enter and Space activate, like a click.
			this.element = plugin.addStatusBarItem();
			this.element.addClass("mod-clickable");
			this.element.setAttribute("role", "button");
			this.element.setAttribute("tabindex", "0");
			plugin.registerDomEvent(this.element, "click", showState);
			plugin.registerDomEvent(this.element, "keydown", (event) => {
				if (event.key === "Enter" || event.key === " ") {
					event.preventDefault();
					showState();
				}
			});
		}
		this.render();
	}

	showStatus(status: SyncStatus): void {
		this.label = statusLabel(status, this.strings);
		this.render();
	}

	/** Shows `notice` as an Obsidian notice, in the user's language. */
	showNotice(notice: SyncNotice): void {
		new Notice(noticeText(notice, this.strings));
	}

	/**
	 * Asks `prompt` in the Deletion guard's modal and resolves with the
	 * answer; null if the plugin unloads while it is open.
	 */
	async askDeletions(prompt: DeletionPrompt): Promise<DeletionAnswer> {
		const modal = new DeletionGuardModal(this.plugin.app, this.strings, prompt);
		this.prompts.add(modal);
		try {
			return await modal.ask();
		} finally {
			this.prompts.delete(modal);
		}
	}

	/**
	 * Shows `preview` in the First sync modal and resolves with the answer;
	 * null if it is closed, or the plugin unloads while it is open.
	 */
	async askFirstSync(preview: FirstSyncPreview): Promise<FirstSyncAnswer> {
		const modal = new FirstSyncModal(this.plugin.app, this.strings, preview);
		this.prompts.add(modal);
		try {
			return await modal.ask();
		} finally {
			this.prompts.delete(modal);
		}
	}

	/**
	 * Puts the label on the entry point: the status bar item's text, or the
	 * ribbon icon's tooltip. The ribbon icon itself stays as it is; whether
	 * it can change at runtime is checked with the Sync window.
	 */
	private render(): void {
		if (Platform.isMobile) setTooltip(this.element, this.label);
		else this.element.setText(this.label);
	}
}
