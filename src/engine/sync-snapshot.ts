/**
 * The Sync snapshot (glossary): this device's own record of how its vault
 * and the Remote looked after its last successful sync of each path. It
 * never leaves the device. Changes are found against it: a vault file
 * changed when its content hash differs from the recorded one, a Remote
 * file when its revision token does (spec, "Remote layout and change
 * detection").
 */
import type { VaultPath } from "./local-vault";

/**
 * What the snapshot records for one path, written only once both sides
 * hold the same content:
 * - a file: its revision on the Remote and the content hash of its bytes;
 * - a folder: only that it exists on both sides.
 */
export type SnapshotEntry =
	| { readonly kind: "file"; readonly revision: string; readonly hash: string }
	| { readonly kind: "folder" };

/** The snapshot as a whole: entries by vault path, empty before the first sync. */
export type SyncSnapshot = ReadonlyMap<VaultPath, SnapshotEntry>;
