import type { Connection } from "./ports";

/**
 * What the engine reports about sync on this device. It describes facts;
 * the shell decides how to show them. More states arrive with the tickets
 * that produce them.
 *
 * - `notConnected`: the device has no Connection.
 * - `connected`: the device has a Connection; it stands in for the sync
 *   states (Synced, Syncing…) until syncing exists.
 */
export type SyncStatus = { readonly state: "notConnected" } | { readonly state: "connected" };

/** The status a device shows for its Connection, or for having none. */
export function statusOf(connection: Connection | null): SyncStatus {
	return connection === null ? { state: "notConnected" } : { state: "connected" };
}
