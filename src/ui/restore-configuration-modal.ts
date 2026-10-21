import { SuggestModal, type App } from "obsidian";
import type { KeptConfiguration } from "../engine/ports";
import { keptConfigurationItem } from "./configuration-text";
import type { Strings } from "./i18n/strings";

/**
 * "Restore local configuration": lists the local configuration versions
 * kept on configuration conflicts, newest first, and restores the one the
 * user picks; the Sync window's Conflicts tab lists them too.
 */
export class RestoreConfigurationModal extends SuggestModal<KeptConfiguration> {
	/**
	 * @param app the Obsidian app
	 * @param strings the UI strings in the user's language
	 * @param kept the kept versions, newest first
	 * @param restore restores the version picked
	 */
	constructor(
		app: App,
		private readonly strings: Strings,
		private readonly kept: readonly KeptConfiguration[],
		private readonly restore: (version: KeptConfiguration) => void,
	) {
		super(app);
		this.setPlaceholder(strings.restoreConfigurationPlaceholder);
	}

	/** The kept versions whose item text holds `query`, without case, in their order. */
	getSuggestions(query: string): KeptConfiguration[] {
		const wanted = query.toLowerCase();
		return this.kept.filter((version) => keptConfigurationItem(version, this.strings).toLowerCase().includes(wanted));
	}

	/** Shows `version` by its file and when it was kept. */
	renderSuggestion(version: KeptConfiguration, el: HTMLElement): void {
		el.setText(keptConfigurationItem(version, this.strings));
	}

	/** Restores the version picked. */
	onChooseSuggestion(version: KeptConfiguration): void {
		this.restore(version);
	}
}
