import { Modal, type App } from "obsidian";
import { fitForPhone } from "./phone-modal";

/**
 * A modal that asks the user one question, fitted for phones: `ask` opens
 * it and settles once, with the answer a subclass gives through `answer`,
 * which closes it, or with null when it is closed without one, by the user
 * or by the plugin unloading.
 */
export abstract class PromptModal<A> extends Modal {
	/** Settles the pending `ask`; cleared once it has been answered. */
	private settle: ((answer: A | null) => void) | undefined;

	/** @param app the Obsidian app */
	constructor(app: App) {
		super(app);
		fitForPhone(this);
	}

	/** Opens the modal and resolves with the user's answer, null if it is closed without one. */
	ask(): Promise<A | null> {
		return new Promise((resolve) => {
			this.settle = resolve;
			this.open();
		});
	}

	override onClose(): void {
		this.contentEl.empty();
		this.answer(null);
	}

	/** Gives `answer` to the pending `ask` once, and closes the modal unless it is the null of closing. */
	protected answer(answer: A | null): void {
		const settle = this.settle;
		this.settle = undefined;
		settle?.(answer);
		if (answer !== null) this.close();
	}
}
