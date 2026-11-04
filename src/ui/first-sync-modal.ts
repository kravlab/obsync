import { Setting, type App } from "obsidian";
import type { FirstSyncAnswer, FirstSyncPreview } from "../engine/first-sync";
import { firstSyncPreviewText } from "./first-sync-preview-text";
import type { Strings } from "./i18n/strings";
import { PromptModal } from "./prompt-modal";

/**
 * The First sync preview (spec, "First sync"): how many files the first
 * sync downloads, uploads, finds identical and finds different, the full
 * list on request, the option to keep the Dropbox version of every
 * differing file, and Start. Closing it without starting answers null,
 * which holds sync until "Sync now".
 */
export class FirstSyncModal extends PromptModal<NonNullable<FirstSyncAnswer>> {
	/** Whether the user chose to keep the Dropbox version of every differing file. */
	private keepRemote = false;

	/**
	 * @param app the Obsidian app
	 * @param strings the UI strings in the user's language
	 * @param preview what the engine would do
	 */
	constructor(
		app: App,
		private readonly strings: Strings,
		private readonly preview: FirstSyncPreview,
	) {
		super(app);
	}

	override onOpen(): void {
		const { contentEl, strings, preview } = this;
		const text = firstSyncPreviewText(preview, strings);
		this.setTitle(strings.firstSyncTitle);
		contentEl.createEl("p", { text: strings.firstSyncIntro });
		const sections = [
			[text.toDownload, preview.toDownload],
			[text.toUpload, preview.toUpload],
			[text.identical, preview.identical],
			[text.differing, text.differingFiles],
		] as const;
		for (const [heading] of sections) contentEl.createEl("p", { text: heading });
		const list = contentEl.createDiv({ cls: "seamsync-first-sync-list" });
		list.hide();
		for (const [heading, items] of sections) {
			if (items.length === 0) continue;
			list.createEl("strong", { text: heading });
			const entries = list.createEl("ul");
			for (const item of items) entries.createEl("li", { text: item });
		}
		if (preview.differing.length > 0) {
			new Setting(contentEl)
				.setName(strings.firstSyncKeepRemote)
				.setDesc(strings.firstSyncKeepRemoteDescription)
				.addToggle((toggle) => toggle.setValue(this.keepRemote).onChange((value) => (this.keepRemote = value)));
		}
		contentEl.createEl("p", { text: strings.firstSyncCloseHint, cls: "setting-item-description" });
		new Setting(contentEl)
			.addButton((button) =>
				button.setButtonText(strings.firstSyncShowList).onClick(() => {
					list.toggle(!list.isShown());
					button.setButtonText(list.isShown() ? strings.firstSyncHideList : strings.firstSyncShowList);
				}),
			)
			.addButton((button) =>
				button
					.setButtonText(strings.firstSyncStart)
					.setCta()
					.onClick(() => this.answer({ differing: this.keepRemote ? "keepRemote" : "merge" })),
			);
	}
}
