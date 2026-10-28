import { Setting, type App } from "obsidian";
import type { SettingsCollisionAnswer, SettingsCollisionPrompt, SharedSettingName } from "../engine/settings-change";
import { fill } from "./i18n/fill";
import type { Strings } from "./i18n/strings";
import { PromptModal } from "./prompt-modal";
import { settingNameText, settingValueText } from "./shared-settings-text";

/**
 * The prompt of a collision of two changes of the shared Remote settings
 * (spec, "Concurrency and the no-loss guarantee"): each setting both
 * devices changed, with a choice between this device's value and the
 * other's, this device's chosen at first, and Apply. Closing it without
 * applying answers null, which holds sync until "Sync now".
 */
export class SettingsCollisionModal extends PromptModal<NonNullable<SettingsCollisionAnswer>> {
	/** The colliding settings that keep this device's value, as chosen so far. */
	private readonly keepMine: Set<SharedSettingName>;

	/**
	 * @param app the Obsidian app
	 * @param strings the UI strings in the user's language
	 * @param prompt what the engine asks
	 */
	constructor(
		app: App,
		private readonly strings: Strings,
		private readonly prompt: SettingsCollisionPrompt,
	) {
		super(app);
		this.keepMine = new Set(prompt.collisions);
	}

	override onOpen(): void {
		const { contentEl, strings, prompt, keepMine } = this;
		this.setTitle(strings.collisionTitle);
		contentEl.createEl("p", { text: strings.collisionIntro });
		for (const name of prompt.collisions) {
			new Setting(contentEl).setName(settingNameText(name, strings)).addDropdown((dropdown) =>
				dropdown
					.addOption("mine", fill(strings.collisionMine, { value: settingValueText(name, prompt.mine, strings) }))
					.addOption("remote", fill(strings.collisionRemote, { value: settingValueText(name, prompt.remote, strings) }))
					.setValue(keepMine.has(name) ? "mine" : "remote")
					.onChange((value) => {
						if (value === "mine") keepMine.add(name);
						else keepMine.delete(name);
					}),
			);
		}
		contentEl.createEl("p", { text: strings.collisionCloseHint, cls: "setting-item-description" });
		new Setting(contentEl).addButton((button) =>
			button
				.setButtonText(strings.collisionApply)
				.setCta()
				.onClick(() => this.answer({ keepMine: prompt.collisions.filter((name) => keepMine.has(name)) })),
		);
	}
}
