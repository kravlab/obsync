import { Notice, Platform, setTooltip, type Plugin } from "obsidian";
import type { DeletionAnswer, DeletionPrompt } from "../engine/deletion-guard";
import type { FirstSyncAnswer, FirstSyncPreview } from "../engine/first-sync";
import type { SyncNotice } from "../engine/notices";
import type { KeptConfiguration, UiPort } from "../engine/ports";
import type { SyncStatus } from "../engine/status";
import type { SkippedFile } from "../engine/sync-listing";
import { keptConfigurationLine } from "./configuration-text";
import type { Strings } from "./i18n/strings";
import { DeletionGuardModal } from "./deletion-guard-modal";
import { FirstSyncModal } from "./first-sync-modal";
import { noticeText } from "./notice-text";
import { skippedLines, withSkippedCount } from "./skipped-text";
import { statusLabel } from "./status-label";

/** How many skipped files the click notice lists before it says how many more there are. */
const NOTICE_SKIPPED_LINES = 20;

/**
 * Shows the sync status where the platform has room for it: a status bar
 * item on desktop, a ribbon icon on mobile, which has no status bar, with
 * the count of skipped files after it. A click on either shows the status
 * in a notice, with the first skipped files and their reasons and how many
 * local configuration versions are kept to restore, until the Sync window
 * and its Skipped and Conflicts tabs exist. It is the shell's UI port: the
 * engine reports each status, skipped-files list and kept-versions list
 * here, and each sync notice,
 * shown as an Obsidian notice, and asks the Deletion guard's question
 * through it.
 */
export class StatusIndicator implements UiPort {
	/** The status text, without the skipped count. */
	private label: string;
	/** The files the last sync skipped, as the engine reported them. */
	private skipped: readonly SkippedFile[] = [];
	/** The local configuration versions kept to restore, as the engine reported them last. */
	private kept: readonly KeptConfiguration[] = [];
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
			const kept = keptConfigurationLine(this.kept, this.strings);
			const lines = [this.text(), ...skippedLines(this.skipped, this.strings, NOTICE_SKIPPED_LINES)];
			new Notice([...lines, ...(kept === null ? [] : [kept])].join("\n"));
		};

		if (Platform.isMobile) {
			this.element = plugin.addRibbonIcon("cloud-off", this.text(), showState);
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

	/** Shows the count of `files` after the status, and the files themselves in the click notice. */
	showSkipped(files: readonly SkippedFile[]): void {
		this.skipped = files;
		this.render();
	}

	/** Keeps `kept` for the click notice, which tells how many versions there are to restore. */
	showConfigurationConflicts(kept: readonly KeptConfiguration[]): void {
		this.kept = kept;
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
	 * Puts the label, with the skipped count, on the entry point: the status bar item's text, or the
	 * ribbon icon's tooltip. The ribbon icon itself stays as it is; whether
	 * it can change at runtime is checked with the Sync window.
	 */
	private render(): void {
		if (Platform.isMobile) setTooltip(this.element, this.text());
		else this.element.setText(this.text());
	}

	/** The status text with the skipped count after it. */
	private text(): string {
		return withSkippedCount(this.label, this.skipped, this.strings);
	}
}
