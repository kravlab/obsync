/**
 * The sync engine: all sync logic, provider-agnostic, reaching the outside
 * world only through its ports (spec, "Architecture and modules"). The
 * shell builds one per device with `createSyncEngine`.
 */
import type { EnginePorts } from "./ports";
import { statusOf } from "./status";

/** One device's sync engine. */
export interface SyncEngine {
	/**
	 * Starts the engine once the vault is open: reads this device's
	 * Connection and shows the resulting status, "Not connected" or
	 * "Connected". Syncing a connected device arrives with the sync tickets.
	 */
	start(): Promise<void>;
}

/** Builds a sync engine over `ports`. */
export function createSyncEngine(ports: EnginePorts): SyncEngine {
	return {
		async start(): Promise<void> {
			const connection = await ports.deviceStore.loadConnection();
			ports.ui.showStatus(statusOf(connection));
		},
	};
}
