/**
 * What the engine reports about sync on this device. It describes facts;
 * the shell decides how to show them. More states arrive with the tickets
 * that produce them.
 */
export type SyncStatus = { readonly state: "notConnected" };
