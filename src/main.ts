import { Notice, Platform, Plugin, getLanguage } from "obsidian";
import type { SyncStatus } from "./engine/status";
import { selectStrings } from "./ui/i18n/strings";
import { statusLabel } from "./ui/status-label";

/**
 * The plugin shell: Obsidian's entry point. It owns only UI wiring; all
 * sync logic lives in the engine (src/engine), which never imports Obsidian.
 */
export default class ObsyncPlugin extends Plugin {
	/**
	 * Called by Obsidian when the plugin is enabled or the app starts. Shows
	 * the sync status where the platform has room for it: a status bar item
	 * on desktop, a ribbon icon on mobile, which has no status bar. A click
	 * on either shows the status in a notice until the Sync window exists.
	 *
	 * The status is fixed at Not connected until the engine is wired in;
	 * strings follow Obsidian's language as read at load.
	 */
	override onload(): void {
		const strings = selectStrings(getLanguage());
		const status: SyncStatus = { state: "notConnected" };
		const label = statusLabel(status, strings);
		const showState = (): void => {
			new Notice(label);
		};

		if (Platform.isMobile) {
			this.addRibbonIcon("cloud-off", label, showState);
		} else {
			// A status bar item is a plain div, so it is made a focusable
			// button that Enter and Space activate, like a click.
			const item = this.addStatusBarItem();
			item.addClass("mod-clickable");
			item.setText(label);
			item.setAttribute("role", "button");
			item.setAttribute("tabindex", "0");
			this.registerDomEvent(item, "click", showState);
			this.registerDomEvent(item, "keydown", (event) => {
				if (event.key === "Enter" || event.key === " ") {
					event.preventDefault();
					showState();
				}
			});
		}
	}
}
