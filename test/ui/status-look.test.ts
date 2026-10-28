import { describe, expect, it } from "vitest";
import type { SyncStatus } from "../../src/engine/status";
import { statusIcon, statusTone } from "../../src/ui/status-look";

describe("statusTone and statusIcon", () => {
	it.each([
		[{ state: "synced" }, "ok", "cloud"],
		[{ state: "syncing" }, "busy", "refresh-cw"],
		[{ state: "connected" }, "idle", "cloud"],
		[{ state: "notConnected" }, "idle", "cloud-off"],
		[{ state: "offline" }, "idle", "cloud-off"],
		[{ state: "deletionsOnHold" }, "attention", "pause"],
		[{ state: "firstSyncWaiting" }, "attention", "pause"],
		[{ state: "settingsCollision" }, "attention", "pause"],
		[{ state: "reconnectNeeded" }, "error", "log-in"],
		[{ state: "syncFailed", cause: "permanent" }, "error", "alert-triangle"],
	] as const)("gives %o its dot colour and ribbon icon", (status: SyncStatus, tone, icon) => {
		expect(statusTone(status)).toBe(tone);
		expect(statusIcon(status)).toBe(icon);
	});
});
