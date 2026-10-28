import { Notice, Platform, setIcon, setTooltip, type Plugin } from "obsidian";
import type { ActivityEvent, ActivityUi } from "../engine/activity-log";
import { NO_CONFLICTS, type SyncConflicts } from "../engine/conflicts";
import type { DeletionAnswer, DeletionPrompt } from "../engine/deletion-guard";
import type { FirstSyncAnswer, FirstSyncPreview } from "../engine/first-sync";
import type { SyncNotice } from "../engine/notices";
import type { SettingsCollisionAnswer, SettingsCollisionPrompt } from "../engine/settings-change";
import type { SyncStatus } from "../engine/status";
import type { SkippedFile } from "../engine/sync-listing";
import { DeletionGuardModal } from "./deletion-guard-modal";
import { FirstSyncModal } from "./first-sync-modal";
import type { Strings } from "./i18n/strings";
import { noticeText } from "./notice-text";
import { OnboardingModal } from "./onboarding-modal";
import { SettingsCollisionModal } from "./settings-collision-modal";
import { statusIcon, statusTone } from "./status-look";
import { statusText } from "./status-text";
import type { ShownSync, ShownSyncSource } from "./sync-window";

/**
 * The shell's UI port and the status entry point (spec, "Status, notices,
 * guidance"). It keeps what the engine reported last (status, conflicts,
 * skipped files, activity log) for the Sync window, which it tells of
 * every change, and shows the status where the platform has room for it:
 *
 * - desktop: a status bar item with a dot coloured by the state, then the
 *   status with its conflict and skipped counts;
 * - mobile, which has no status bar: a ribbon icon whose icon follows the
 *   state, with the same text as its tooltip.
 *
 * A click on either opens the Sync window. Each sync notice is shown as an
 * Obsidian notice, the Deletion guard, First sync and settings collision
 * prompts are asked through it, and the onboarding is shown through it,
 * so a First sync preview waits behind it.
 */
export class StatusIndicator implements ActivityUi, ShownSyncSource {
	/** What the engine reported last. */
	private facts: ShownSync = { status: { state: "notConnected" }, conflicts: NO_CONFLICTS, skipped: [], activity: [] };
	/** Called after every change of `facts`, while subscribed. */
	private readonly listeners = new Set<() => void>();
	/**
	 * Deletion guard, First sync and settings collision prompts and the
	 * onboarding open now; the plugin's unload closes them, which answers null.
	 */
	private readonly prompts = new Set<DeletionGuardModal | FirstSyncModal | SettingsCollisionModal | OnboardingModal>();
	/** Settles once the onboarding open now is closed; a First sync preview waits for it. */
	private onboarding: Promise<unknown> | undefined;
	/** Whether the plugin unloaded: nothing opens any more. */
	private unloaded = false;
	/** The status bar item (desktop) or ribbon icon (mobile). */
	private readonly element: HTMLElement;
	/** The status bar item's dot; absent on mobile. */
	private readonly dot: HTMLElement | undefined;
	/** The status bar item's text; absent on mobile. */
	private readonly label: HTMLElement | undefined;

	/**
	 * Adds the entry point to `plugin`, which removes it on unload.
	 *
	 * @param plugin the plugin owning the entry point and its events
	 * @param strings the UI strings in the user's language
	 * @param openWindow opens the Sync window, on a click of the entry point
	 */
	constructor(
		private readonly plugin: Plugin,
		private readonly strings: Strings,
		openWindow: () => void,
	) {
		// A prompt left open would let a sync of the unloaded plugin delete files later.
		plugin.register(() => {
			this.unloaded = true;
			for (const prompt of this.prompts) prompt.close();
		});
		if (Platform.isMobile) {
			this.element = plugin.addRibbonIcon(statusIcon(this.facts.status), this.text(), openWindow);
		} else {
			// A status bar item is a plain div, so it is made a focusable
			// button that Enter and Space activate, like a click.
			this.element = plugin.addStatusBarItem();
			this.element.addClass("mod-clickable", "obsync-status");
			this.element.setAttribute("role", "button");
			this.element.setAttribute("tabindex", "0");
			this.dot = this.element.createSpan();
			this.label = this.element.createSpan();
			plugin.registerDomEvent(this.element, "click", openWindow);
			plugin.registerDomEvent(this.element, "keydown", (event) => {
				if (event.key === "Enter" || event.key === " ") {
					event.preventDefault();
					openWindow();
				}
			});
		}
		this.render();
	}

	shown(): ShownSync {
		return this.facts;
	}

	onChange(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	showStatus(status: SyncStatus): void {
		this.update({ status });
	}

	/** Shows the count of `files` after the status, and the files in the Sync window's Skipped tab. */
	showSkipped(files: readonly SkippedFile[]): void {
		this.update({ skipped: files });
	}

	/** Shows the count of `conflicts` after the status, and each one in the Sync window's Conflicts tab. */
	showConflicts(conflicts: SyncConflicts): void {
		this.update({ conflicts });
	}

	/** Shows `events` in the Sync window's Activity tab. */
	showActivity(events: readonly ActivityEvent[]): void {
		this.update({ activity: events });
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
	 * Shows the onboarding and resolves once it is closed, by the user or
	 * because the plugin unloads; tells whether the plugin is still loaded
	 * then. A First sync preview asked for meanwhile waits for it.
	 */
	async showOnboarding(): Promise<boolean> {
		const modal = new OnboardingModal(this.plugin.app, this.strings);
		this.prompts.add(modal);
		const closed = modal.ask();
		this.onboarding = closed;
		try {
			await closed;
		} finally {
			this.prompts.delete(modal);
			if (this.onboarding === closed) this.onboarding = undefined;
		}
		return !this.unloaded;
	}

	/**
	 * Shows `preview` in the First sync modal, once the onboarding open is
	 * closed, so it never covers it, and resolves with the answer; null if
	 * it is closed, or the plugin unloads before or while it is open.
	 */
	async askFirstSync(preview: FirstSyncPreview): Promise<FirstSyncAnswer> {
		await this.onboarding;
		if (this.unloaded) return null;
		const modal = new FirstSyncModal(this.plugin.app, this.strings, preview);
		this.prompts.add(modal);
		try {
			return await modal.ask();
		} finally {
			this.prompts.delete(modal);
		}
	}

	/**
	 * Asks `prompt` in the settings collision modal and resolves with the
	 * answer; null if it is closed, or the plugin unloads while it is open.
	 */
	async askSettingsCollision(prompt: SettingsCollisionPrompt): Promise<SettingsCollisionAnswer> {
		const modal = new SettingsCollisionModal(this.plugin.app, this.strings, prompt);
		this.prompts.add(modal);
		try {
			return await modal.ask();
		} finally {
			this.prompts.delete(modal);
		}
	}

	/** Takes `change` into what is shown, redraws the entry point and tells every listener. */
	private update(change: Partial<ShownSync>): void {
		this.facts = { ...this.facts, ...change };
		this.render();
		for (const listener of this.listeners) listener();
	}

	/**
	 * Puts the status on the entry point: the dot's colour and the text of
	 * the status bar item, or the ribbon icon and its tooltip. Whether
	 * Obsidian mobile shows an icon changed after it was added is checked
	 * by hand on Android and iOS.
	 */
	private render(): void {
		const { status } = this.facts;
		if (this.dot === undefined || this.label === undefined) {
			setIcon(this.element, statusIcon(status));
			setTooltip(this.element, this.text());
			return;
		}
		this.dot.className = `obsync-dot obsync-dot-${statusTone(status)}`;
		this.label.setText(this.text());
	}

	/** The status text with the conflict and skipped counts after it. */
	private text(): string {
		const { status, conflicts, skipped } = this.facts;
		return statusText(status, conflicts, skipped, this.strings);
	}
}
