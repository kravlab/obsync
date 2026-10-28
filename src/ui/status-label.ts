import type { SyncStatus } from "../engine/status";
import type { Strings } from "./i18n/strings";

/**
 * The text that tells the user a sync status, in their language. The status
 * bar item, the ribbon icon's tooltip and the click notice all show it, so
 * the three never disagree.
 */
export function statusLabel(status: SyncStatus, strings: Strings): string {
	switch (status.state) {
		case "notConnected":
			return strings.statusNotConnected;
		case "connected":
			return strings.statusConnected;
		case "syncing":
			return strings.statusSyncing;
		case "synced":
			return strings.statusSynced;
		case "offline":
			return strings.statusOffline;
		case "syncFailed":
			return strings.statusSyncFailed;
		case "reconnectNeeded":
			return strings.statusReconnectNeeded;
		case "deletionsOnHold":
			return strings.statusDeletionsOnHold;
		case "firstSyncWaiting":
			return strings.statusFirstSyncWaiting;
		case "settingsCollision":
			return strings.statusSettingsCollision;
	}
}
