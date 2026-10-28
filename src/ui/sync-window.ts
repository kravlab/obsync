import { Modal, Setting, type App } from "obsidian";
import type { ActivityEvent } from "../engine/activity-log";
import { conflictCount, type SyncConflicts } from "../engine/conflicts";
import type { VaultPath } from "../engine/local-vault";
import type { SyncStatus } from "../engine/status";
import type { SkippedFile } from "../engine/sync-listing";
import { activityLine } from "./activity-text";
import { keptConfigurationItem } from "./configuration-text";
import { fill } from "./i18n/fill";
import type { Strings } from "./i18n/strings";
import { helpSections } from "./help-text";
import { fitForPhone } from "./phone-modal";
import { skippedLines } from "./skipped-text";
import { statusTone } from "./status-look";
import { statusText } from "./status-text";
import { tabContent } from "./sync-tab-content";

/** The Sync window's tabs. */
export type SyncTab = "conflicts" | "skipped" | "activity" | "help";

/** What the shell shows about sync: the facts the engine reported last. */
export interface ShownSync {
	readonly status: SyncStatus;
	readonly conflicts: SyncConflicts;
	readonly skipped: readonly SkippedFile[];
	/** The activity log, newest first. */
	readonly activity: readonly ActivityEvent[];
}

/** Where the Sync window reads what to show, and learns that it changed. */
export interface ShownSyncSource {
	/** What the engine reported last. */
	shown(): ShownSync;
	/** Calls `listener` after every change of what is shown; the returned function stops it. */
	onChange(listener: () => void): () => void;
}

/** What the Sync window's buttons and lists do; the shell wires them to the engine and the workspace. */
export interface SyncWindowActions {
	/** Starts a sync from the user ("Sync now"). */
	syncNow(): void;
	/** Opens the connect window, to log in again or connect at all. */
	connect(): void;
	/** Opens the vault file `path`, with the cursor on its first Conflict block when `atFirstConflict`. */
	openFile(path: VaultPath, atFirstConflict: boolean): void;
	/** "Restore local" of the kept configuration version `id`. */
	restore(id: string): void;
	/** Copies the bug report to the clipboard. */
	copyBugReport(): void;
	/** Opens the onboarding again, from help. */
	showOnboarding(): void;
}

/**
 * The Sync window (spec, "Status, notices, guidance"): the status with its
 * dot and counts, a "Sync now" button, or "Reconnect" while sync is paused
 * for a new login ("Connect" without a Connection), and four tabs:
 * Conflicts (files with Conflict blocks, Conflict copies, kept
 * configuration versions with "Restore local"), Skipped (each file with
 * its reason), Activity (the log in plain words, with "Copy for a bug
 * report") and Help (help-text.ts, with the onboarding to open again).
 * While open it follows what is shown: the header and tab
 * labels are updated in place on every change, and the tab body is redrawn
 * only when its own data changed by value, keeping the scroll position,
 * so a status change does not take the focus away from a list.
 */
export class SyncWindow extends Modal {
	/** Stops the updates on change, while open. */
	private stopListening: (() => void) | undefined;
	/** The header's dot, status text and button, drawn on open. */
	private header: { dot: HTMLElement; text: HTMLElement; button: HTMLButtonElement } | undefined;
	/** The tab buttons, drawn on open. */
	private readonly tabButtons = new Map<SyncTab, HTMLButtonElement>();
	/** Where the shown tab's body is drawn. */
	private body: HTMLElement | undefined;
	/** The tab and `tabContent` the body was last drawn from; undefined to draw it on the next update. */
	private drawn: { tab: SyncTab; content: string } | undefined;

	/**
	 * @param app the Obsidian app
	 * @param strings the UI strings in the user's language
	 * @param source what to show
	 * @param actions what the buttons and lists do
	 * @param tab the tab shown first
	 */
	constructor(
		app: App,
		private readonly strings: Strings,
		private readonly source: ShownSyncSource,
		private readonly actions: SyncWindowActions,
		private tab: SyncTab,
	) {
		super(app);
		fitForPhone(this);
		this.modalEl.addClass("obsync-sync-window");
	}

	override onOpen(): void {
		this.setTitle(this.strings.syncWindowTitle);
		this.drawFrame();
		this.stopListening = this.source.onChange(() => this.update());
		this.update();
	}

	override onClose(): void {
		this.stopListening?.();
		this.stopListening = undefined;
		this.header = undefined;
		this.tabButtons.clear();
		this.body = undefined;
		this.drawn = undefined;
		this.contentEl.empty();
	}

	/** Draws what stays while the window is open: the header, the tab buttons and the body's container. */
	private drawFrame(): void {
		const { contentEl } = this;
		contentEl.empty();
		const header = contentEl.createDiv({ cls: "obsync-sync-header" });
		this.header = {
			dot: header.createSpan(),
			text: header.createSpan(),
			button: header.createEl("button", { cls: "mod-cta" }),
		};
		this.header.button.addEventListener("click", () => this.headerAction());
		const tabs = contentEl.createDiv({ cls: "obsync-sync-tabs", attr: { role: "tablist" } });
		for (const tab of ["conflicts", "skipped", "activity", "help"] as const) {
			const button = tabs.createEl("button", { cls: "obsync-sync-tab", attr: { role: "tab" } });
			button.addEventListener("click", () => {
				this.tab = tab;
				this.update();
			});
			this.tabButtons.set(tab, button);
		}
		this.body = contentEl.createDiv({ cls: "obsync-sync-body" });
	}

	/**
	 * Shows what is shown now: the header and tab labels in place, and the
	 * body redrawn only when the tab or its data changed, keeping the scroll
	 * position.
	 */
	private update(): void {
		const shown = this.source.shown();
		this.updateHeader(shown);
		this.updateTabs(shown);
		const content = tabContent(shown, this.tab);
		const { body, drawn } = this;
		if (body === undefined || (drawn?.tab === this.tab && drawn.content === content)) return;
		const scrolled = { content: this.contentEl.scrollTop, modal: this.modalEl.scrollTop };
		body.empty();
		if (this.tab === "conflicts") this.renderConflicts(body, shown);
		else if (this.tab === "skipped") this.renderSkipped(body, shown);
		else if (this.tab === "activity") this.renderActivity(body, shown);
		else this.renderHelp(body);
		this.drawn = { tab: this.tab, content };
		this.contentEl.scrollTop = scrolled.content;
		this.modalEl.scrollTop = scrolled.modal;
	}

	/** The status dot and text, and the label of the button for what the status calls for. */
	private updateHeader(shown: ShownSync): void {
		if (this.header === undefined) return;
		const { strings } = this;
		const { state } = shown.status;
		this.header.dot.className = `obsync-dot obsync-dot-${statusTone(shown.status)}`;
		this.header.text.setText(statusText(shown.status, shown.conflicts, shown.skipped, strings));
		const label =
			state === "reconnectNeeded" ? strings.reconnect : state === "notConnected" ? strings.connect : strings.syncNow;
		this.header.button.setText(label);
	}

	/** What the header's button does for the status shown now: log in (again) while one is needed, otherwise sync. */
	private headerAction(): void {
		const { state } = this.source.shown().status;
		if (state !== "reconnectNeeded" && state !== "notConnected") {
			this.actions.syncNow();
			return;
		}
		this.close();
		this.actions.connect();
	}

	/** The tab labels with their counts, the shown tab marked. */
	private updateTabs(shown: ShownSync): void {
		const { strings } = this;
		const labels: Record<SyncTab, string> = {
			conflicts: fill(strings.tabConflicts, { count: String(conflictCount(shown.conflicts)) }),
			skipped: fill(strings.tabSkipped, { count: String(shown.skipped.length) }),
			activity: strings.tabActivity,
			help: strings.tabHelp,
		};
		for (const [tab, button] of this.tabButtons) {
			const selected = tab === this.tab;
			button.setText(labels[tab]);
			button.toggleClass("obsync-sync-tab-selected", selected);
			button.setAttribute("aria-selected", String(selected));
		}
	}
	/** Files with Conflict blocks and Conflict copies, each opening its file, then the kept configuration versions. */
	private renderConflicts(body: HTMLElement, { conflicts }: ShownSync): void {
		const { strings, actions } = this;
		if (conflictCount(conflicts) === 0) {
			body.createEl("p", { text: strings.nothingInConflict });
			return;
		}
		const fileSection = (heading: string, paths: readonly VaultPath[], atFirstConflict: boolean): void => {
			if (paths.length === 0) return;
			body.createEl("h4", { text: heading });
			for (const path of paths) {
				const item = body.createEl("button", { text: path, cls: "obsync-sync-item" });
				item.addEventListener("click", () => {
					this.close();
					actions.openFile(path, atFirstConflict);
				});
			}
		};
		fileSection(strings.conflictedFiles, conflicts.conflicted, true);
		fileSection(strings.conflictCopies, conflicts.copies, false);
		if (conflicts.configuration.length === 0) return;
		body.createEl("h4", { text: strings.keptConfigurations });
		for (const version of conflicts.configuration) {
			new Setting(body)
				.setName(keptConfigurationItem(version, strings))
				.addButton((button) => button.setButtonText(strings.restoreLocal).onClick(() => actions.restore(version.id)));
		}
	}

	/** Every skipped file with its reason. */
	private renderSkipped(body: HTMLElement, { skipped }: ShownSync): void {
		const lines = skippedLines(skipped, this.strings);
		if (lines.length === 0) body.createEl("p", { text: this.strings.nothingSkipped });
		for (const line of lines) body.createDiv({ text: line, cls: "obsync-sync-line" });
	}

	/** "Copy for a bug report" with what the report holds, then every event, newest first. */
	private renderActivity(body: HTMLElement, { activity }: ShownSync): void {
		const { strings, actions } = this;
		new Setting(body)
			.setDesc(strings.copyBugReportHint)
			.addButton((button) => button.setButtonText(strings.copyBugReport).onClick(() => actions.copyBugReport()));
		if (activity.length === 0) body.createEl("p", { text: strings.nothingRecorded });
		for (const event of activity) body.createDiv({ text: activityLine(event, strings), cls: "obsync-sync-line" });
	}

	/** The button opening the onboarding again, then every help section under its heading. */
	private renderHelp(body: HTMLElement): void {
		const { strings, actions } = this;
		new Setting(body).addButton((button) =>
			button.setButtonText(strings.showOnboarding).onClick(() => {
				this.close();
				actions.showOnboarding();
			}),
		);
		for (const section of helpSections(strings)) {
			body.createEl("h4", { text: section.heading });
			for (const paragraph of section.paragraphs) body.createEl("p", { text: paragraph });
			if (section.list.length === 0) continue;
			const list = body.createEl("ul");
			for (const item of section.list) list.createEl("li", { text: item });
		}
	}
}
