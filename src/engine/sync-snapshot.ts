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
 * - a file: its revision on the Remote, the content hash of its bytes, and
 *   the vault file's stat when it was read with that content, so an
 *   untouched file need not be hashed again;
 * - a folder: only that it exists on both sides.
 */
export type SnapshotEntry =
	| {
			readonly kind: "file";
			/** The Remote revision both sides hold. */
			readonly revision: string;
			/** The content hash of the bytes both sides hold. */
			readonly hash: string;
			/**
			 * The vault file's size and modification time, taken before it was
			 * read with the content `hash`; absent when the engine wrote the file
			 * itself, so the next sync hashes it again.
			 */
			readonly stat?: VaultFileStat;
	  }
	| { readonly kind: "folder" };

/** A vault file's size and modification time, as a vault listing reports them. */
export interface VaultFileStat {
	/** Size in bytes. */
	readonly size: number;
	/** Modification time in ms since the epoch. */
	readonly mtime: number;
}

/** The snapshot as a whole: entries by vault path, empty before the first sync. */
export type SyncSnapshot = ReadonlyMap<VaultPath, SnapshotEntry>;
