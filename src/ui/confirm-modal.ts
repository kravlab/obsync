import { Setting, type App } from "obsidian";
import type { Strings } from "./i18n/strings";
import { PromptModal } from "./prompt-modal";

/** What a confirmation asks: its title, what it tells, and the text of the button that confirms. */
export interface Confirmation {
	readonly title: string;
	readonly text: string;
	readonly confirm: string;
}

/**
 * A confirmation before an action that cannot be undone, such as
 * forgetting a device: Cancel and the action's button. It answers true
 * when confirmed; Cancel, or closing it, answers null.
 */
export class ConfirmModal extends PromptModal<true> {
	/**
	 * @param app the Obsidian app
	 * @param strings the UI strings in the user's language
	 * @param confirmation what the user is asked
	 */
	constructor(
		app: App,
		private readonly strings: Strings,
		private readonly confirmation: Confirmation,
	) {
		super(app);
	}

	override onOpen(): void {
		const { contentEl, strings, confirmation } = this;
		this.setTitle(confirmation.title);
		contentEl.createEl("p", { text: confirmation.text });
		new Setting(contentEl)
			.addButton((button) => button.setButtonText(strings.cancel).onClick(() => this.close()))
			.addButton((button) => button.setButtonText(confirmation.confirm).onClick(() => this.answer(true)));
	}
}
