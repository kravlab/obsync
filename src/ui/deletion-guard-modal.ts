import { Modal, Setting, type App } from "obsidian";
import type { DeletionAnswer, DeletionPrompt } from "../engine/deletion-guard";
import { deletionPromptText } from "./deletion-prompt-text";
import type { Strings } from "./i18n/strings";

/**
 * The Deletion guard prompt (spec, "Status, notices, guidance", modal
 * prompts): why the sync stopped, how many files it would delete on each
 * side, a list to review every one of them, and Apply or Restore. Closing
 * it without a choice answers null, which holds sync until "Sync now".
 */
export class DeletionGuardModal extends Modal {
	/** Settles the pending `ask`; cleared once it has been answered. */
	private settle: ((answer: DeletionAnswer) => void) | undefined;

	/**
	 * @param app the Obsidian app
	 * @param strings the UI strings in the user's language
	 * @param prompt what the engine asks
	 */
	constructor(
		app: App,
		private readonly strings: Strings,
		private readonly prompt: DeletionPrompt,
	) {
		super(app);
	}

	/** Opens the prompt and resolves with the user's answer, null if it is closed without one. */
	ask(): Promise<DeletionAnswer> {
		return new Promise((resolve) => {
			this.settle = resolve;
			this.open();
		});
	}

	override onOpen(): void {
		const { contentEl, strings, prompt } = this;
		const text = deletionPromptText(prompt, strings);
		this.setTitle(strings.guardTitle);
		contentEl.createEl("p", { text: text.reason });
		for (const line of [text.toRemote, text.toVault]) {
			if (line !== null) contentEl.createEl("p", { text: line });
		}
		const list = contentEl.createDiv({ cls: "obsync-guard-list" });
		list.hide();
		for (const [heading, paths] of [
			[text.toRemote, prompt.toRemote],
			[text.toVault, prompt.toVault],
		] as const) {
			if (heading === null) continue;
			// Each side's paths under its own count line, so the user sees where each file is deleted.
			list.createEl("strong", { text: heading });
			const items = list.createEl("ul");
			for (const path of paths) items.createEl("li", { text: path });
		}
		contentEl.createEl("p", { text: strings.guardCloseHint, cls: "setting-item-description" });
		new Setting(contentEl)
			.addButton((button) =>
				button.setButtonText(strings.guardReview).onClick(() => {
					list.toggle(!list.isShown());
					button.setButtonText(list.isShown() ? strings.guardHideList : strings.guardReview);
				}),
			)
			.addButton((button) => button.setButtonText(strings.guardApply).onClick(() => this.answer("apply")))
			// Restore loses nothing, so it is the highlighted choice.
			.addButton((button) =>
				button
					.setButtonText(strings.guardRestore)
					.setCta()
					.onClick(() => this.answer("restore")),
			);
	}

	override onClose(): void {
		this.contentEl.empty();
		this.answer(null);
	}

	/** Gives `answer` to the pending `ask` once, and closes the prompt. */
	private answer(answer: DeletionAnswer): void {
		const settle = this.settle;
		this.settle = undefined;
		settle?.(answer);
		if (answer !== null) this.close();
	}
}
