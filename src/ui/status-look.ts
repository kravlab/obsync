import type { SyncStatus } from "../engine/status";

/**
 * How a status looks at a glance, the colour of the status dot: `ok`
 * synced, `busy` syncing, `idle` nothing to do or wait for, `attention` a
 * choice waits for the user, `error` sync stopped until something is fixed.
 */
export type StatusTone = "ok" | "busy" | "idle" | "attention" | "error";

/** The tone of `status`'s dot. */
export function statusTone(status: SyncStatus): StatusTone {
	switch (status.state) {
		case "synced":
			return "ok";
		case "syncing":
			return "busy";
		case "connected":
		case "notConnected":
		case "offline":
			return "idle";
		case "deletionsOnHold":
		case "firstSyncWaiting":
			return "attention";
		case "reconnectNeeded":
		case "syncFailed":
			return "error";
	}
}

/** The ribbon icon (a Lucide name, as Obsidian ships them) that shows `status` on mobile. */
export function statusIcon(status: SyncStatus): string {
	switch (status.state) {
		case "synced":
		case "connected":
			return "cloud";
		case "syncing":
			return "refresh-cw";
		case "notConnected":
		case "offline":
			return "cloud-off";
		case "deletionsOnHold":
		case "firstSyncWaiting":
			return "pause";
		case "reconnectNeeded":
			return "log-in";
		case "syncFailed":
			return "alert-triangle";
	}
}
