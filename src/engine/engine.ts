/**
 * The sync engine: all sync logic, provider-agnostic, reaching the outside
 * world only through its ports (spec, "Architecture and modules"). The
 * shell builds one per device with `createSyncEngine`.
 */
import type { EnginePorts } from "./ports";

/** One device's sync engine. */
export interface SyncEngine {
	/**
	 * Starts the engine once the vault is open: reads this device's
	 * Connection and shows the resulting status. A device without a
	 * Connection is "Not connected"; syncing a connected device arrives with
	 * the connect and sync tickets.
	 */
	start(): Promise<void>;
}

/** Builds a sync engine over `ports`. */
export function createSyncEngine(ports: EnginePorts): SyncEngine {
	return {
		async start(): Promise<void> {
			const connection = await ports.deviceStore.loadConnection();
			if (connection === null) ports.ui.showStatus({ state: "notConnected" });
		},
	};
}
