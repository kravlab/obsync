import { Modal, Notice, Setting, TextAreaComponent, type App } from "obsidian";
import type { ConflictBlock } from "../engine/conflict-blocks";
import { shownSides } from "./conflict-sides";
import type { Strings } from "./i18n/strings";

/**
 * The Edit… dialog of a Conflict block: both sides, labelled, and one text
 * field prefilled with this device's side then the other's, to combine by
 * hand. Save replaces the whole block with the field's text; Cancel, or
 * closing the dialog, changes nothing. If the block changed meanwhile,
 * e.g. by a sync, Save changes nothing either and the dialog stays open
 * with a notice, so the text typed into it is not lost.
 */
export class ConflictEditModal extends Modal {
	/**
	 * @param app the Obsidian app
	 * @param strings the UI strings in the user's language
	 * @param block the block being resolved
	 * @param onSave replaces the block with the text the user saved;
	 *   false when the block is no longer there as it was shown
	 */
	constructor(
		app: App,
		private readonly strings: Strings,
		private readonly block: ConflictBlock,
		private readonly onSave: (text: string) => boolean,
	) {
		super(app);
	}

	override onOpen(): void {
		const { contentEl, strings, block } = this;
		this.setTitle(strings.conflictEditTitle);
		this.modalEl.addClass("obsync-conflict-edit");
		const sides = contentEl.createDiv({ cls: "obsync-conflict-edit-sides" });
		for (const { label, text, cls } of shownSides(block, strings)) {
			const side = sides.createDiv({ cls: `obsync-conflict-edit-side ${cls}` });
			side.createEl("strong", { text: label });
			side.createEl("pre", { text });
		}
		contentEl.createEl("p", { text: strings.conflictEditDescription });
		const field = new TextAreaComponent(contentEl).setValue(block.local + block.remote);
		field.inputEl.addClass("obsync-conflict-edit-text");
		new Setting(contentEl)
			.addButton((button) => button.setButtonText(strings.cancel).onClick(() => this.close()))
			.addButton((button) =>
				button
					.setButtonText(strings.save)
					.setCta()
					.onClick(() => {
						if (this.onSave(field.getValue())) this.close();
						else new Notice(strings.conflictChanged);
					}),
			);
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}
