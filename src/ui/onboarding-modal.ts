import { Setting, type App } from "obsidian";
import { practices } from "./help-text";
import type { Strings } from "./i18n/strings";
import { PromptModal } from "./prompt-modal";

/**
 * The onboarding (spec, "Status, notices, guidance"): the four practices
 * that avoid most conflicts, shown once a device has a new Connection and
 * again from help, with "Got it". Its answer only tells that it was read:
 * true for "Got it", null when closed another way.
 */
export class OnboardingModal extends PromptModal<true> {
	/**
	 * @param app the Obsidian app
	 * @param strings the UI strings in the user's language
	 */
	constructor(
		app: App,
		private readonly strings: Strings,
	) {
		super(app);
	}

	override onOpen(): void {
		const { contentEl, strings } = this;
		this.setTitle(strings.onboardingTitle);
		contentEl.createEl("p", { text: strings.onboardingIntro });
		const list = contentEl.createEl("ul");
		for (const practice of practices(strings)) list.createEl("li", { text: practice });
		new Setting(contentEl).addButton((button) =>
			button
				.setButtonText(strings.onboardingDone)
				.setCta()
				.onClick(() => this.answer(true)),
		);
	}
}
