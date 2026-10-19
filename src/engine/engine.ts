/**
 * The sync engine: all sync logic, provider-agnostic, reaching the outside
 * world only through its ports (spec, "Architecture and modules"). The
 * shell builds one per device with `createSyncEngine`.
 */
import { providerSecretId, type EnginePorts } from "./ports";
import { ProviderError, isSyncable } from "./provider";
import { statusOf } from "./status";
import { runSync } from "./sync-run";

/** One device's sync engine. */
export interface SyncEngine {
	/**
	 * Starts the engine once the vault is open: reads this device's
	 * Connection and shows the resulting status, "Not connected" or
	 * "Connected".
	 */
	start(): Promise<void>;
	/**
	 * Syncs this device once ("Sync now"), showing Syncing… and then Synced,
	 * or Sync failed on a provider failure or a provider that cannot be
	 * synced (`isSyncable`). A device without a Connection
	 * only shows Not connected. A call while a sync runs joins that sync
	 * instead of starting another, so two never run at once. Errors that are
	 * not provider failures are bugs: the status shows Sync failed and the
	 * error is thrown.
	 */
	sync(): Promise<void>;
}

/** Builds a sync engine over `ports`. */
export function createSyncEngine(ports: EnginePorts): SyncEngine {
	const { deviceStore, secretStore, providers, vault, ui } = ports;
	let running: Promise<void> | undefined;

	/** One sync, from reading the Connection to the final status. */
	async function syncOnce(): Promise<void> {
		const connection = await deviceStore.loadConnection();
		if (connection === null) {
			ui.showStatus({ state: "notConnected" });
			return;
		}
		ui.showStatus({ state: "syncing" });
		try {
			const secret = secretStore.getSecret(providerSecretId(providers.providerId));
			if (secret === null) {
				// A Connection without its secret cannot reach the Remote; a new
				// login (Reconnect, later) restores it.
				ui.showStatus({ state: "syncFailed" });
				return;
			}
			const provider = await providers.open(connection, secret);
			if (!isSyncable(provider)) {
				ui.showStatus({ state: "syncFailed" });
				return;
			}
			await runSync({ provider, vault, deviceStore });
			ui.showStatus({ state: "synced" });
		} catch (error) {
			ui.showStatus({ state: "syncFailed" });
			if (!(error instanceof ProviderError)) throw error;
		}
	}

	return {
		async start(): Promise<void> {
			const connection = await deviceStore.loadConnection();
			ui.showStatus(statusOf(connection));
		},

		sync(): Promise<void> {
			running ??= syncOnce().finally(() => {
				running = undefined;
			});
			return running;
		},
	};
}
