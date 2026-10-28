import type { Connection } from "./ports";
import type { ProviderErrorCategory } from "./provider";

/**
 * Why a sync failed: the provider failure's category, or
 * - `unsupportedProvider`: the provider cannot be synced (`isSyncable`);
 * - `unreadableSettings`: the Remote's shared settings are missing or
 *   cannot be read, so files could be classified unlike on other devices;
 * - `bug`: an error that is not a provider failure, a defect in the plugin.
 */
export type SyncFailureCause = ProviderErrorCategory | "unsupportedProvider" | "unreadableSettings" | "bug";

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
 * - `syncFailed`: the last sync stopped on a failure that is neither
 *   `transient` nor `auth`; the next one starts over. `cause` tells why,
 *   for the activity log and bug reports; `detail`, when the failure was an
 *   error with something to tell, is its `failureDetail`, so it can be
 *   diagnosed from a bug report.
 * - `reconnectNeeded`: the provider refused this device's login, or its
 *   secret is gone, so sync is paused on this device until the user logs
 *   in again (spec, "Status, notices, guidance"). The pause is kept with
 *   the Connection, so it outlives a restart.
 * - `deletionsOnHold`: the Deletion guard stopped a sync and its prompt
 *   was closed without an answer; nothing syncs until the user asks for a
 *   sync, which asks again.
 * - `firstSyncWaiting`: the preview of a First sync was closed without
 *   starting it; nothing syncs until the user asks for a sync, which shows
 *   the preview again.
 * - `settingsCollision`: a change of the shared Remote settings made here
 *   collided with one made on another device and the prompt was closed
 *   without picking the values; nothing syncs until the user asks for a
 *   sync, which asks again.
 */
export type SyncStatus =
	| { readonly state: "notConnected" }
	| { readonly state: "connected" }
	| { readonly state: "syncing" }
	| { readonly state: "synced" }
	| { readonly state: "offline" }
	| { readonly state: "syncFailed"; readonly cause: SyncFailureCause; readonly detail?: string }
	| { readonly state: "reconnectNeeded" }
	| { readonly state: "deletionsOnHold" }
	| { readonly state: "firstSyncWaiting" }
	| { readonly state: "settingsCollision" };

/** The status a device shows for its Connection, or for having none, before it syncs. */
export function statusOf(connection: Connection | null): SyncStatus {
	if (connection === null) return { state: "notConnected" };
	return connection.reconnectNeeded === true ? { state: "reconnectNeeded" } : { state: "connected" };
}
