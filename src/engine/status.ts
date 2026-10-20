import type { Connection } from "./ports";

/**
 * What the engine reports about sync on this device. It describes facts;
 * the shell decides how to show them. More states arrive with the tickets
 * that produce them.
 *
 * - `notConnected`: the device has no Connection.
 * - `connected`: the device has a Connection and has not synced since the
 *   plugin started.
 * - `syncing`: a sync is running.
 * - `synced`: the last sync finished. Conflict blocks and Conflict
 *   copies it left do not stop this state.
 * - `offline`: the last sync could not reach the Remote (`transient`); it
 *   retries with growing backoff and on the next trigger.
 * - `syncFailed`: the last sync stopped on a failure that is not
 *   `transient`; the next one starts over. It stands in for Reconnect
 *   needed until that exists.
 */
export type SyncStatus =
	| { readonly state: "notConnected" }
	| { readonly state: "connected" }
	| { readonly state: "syncing" }
	| { readonly state: "synced" }
	| { readonly state: "offline" }
	| { readonly state: "syncFailed" };

/** The status a device shows for its Connection, or for having none. */
export function statusOf(connection: Connection | null): SyncStatus {
	return connection === null ? { state: "notConnected" } : { state: "connected" };
}
