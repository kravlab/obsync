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
 * - a file: its revision on the Remote, the content hash of its bytes and
 *   their size, and the vault file's stat when it was read with that
 *   content, so an untouched file need not be hashed again;
 * - a folder: only that it exists on both sides.
 *
 * Either may carry the Remote entry's stable id, when the provider gives
 * one, which finds the entry again after a rename on the Remote.
 *
 * After a rename the entry moves to the new path keeping its revision,
 * unless the Remote is known to hold the synced content there under
 * another one: a revision the new path may not have, so the next
 * comparison reads the Remote file instead of trusting it.
 */
export type SnapshotEntry =
	| {
			readonly kind: "file";
			/** The Remote revision both sides hold. */
			readonly revision: string;
			/** The content hash of the bytes both sides hold. */
			readonly hash: string;
			/** The size in bytes of the content `hash` is of; absent in entries recorded before it was kept. */
			readonly size?: number;
			/** The Remote file's stable id, when the provider gives one. */
			readonly stableId?: string;
			/**
			 * The vault file's size and modification time, taken before it was
			 * read with the content `hash`; absent when the engine wrote the file
			 * itself, so the next sync hashes it again.
			 */
			readonly stat?: VaultFileStat;
	  }
	| {
			readonly kind: "folder";
			/** The Remote folder's stable id, when the provider gives one. */
			readonly stableId?: string;
	  };

/** What the snapshot records for a file. */
export type SyncedFile = Extract<SnapshotEntry, { kind: "file" }>;

/** A vault file's size and modification time, as a vault listing reports them. */
export interface VaultFileStat {
	/** Size in bytes. */
	readonly size: number;
	/** Modification time in ms since the epoch. */
	readonly mtime: number;
}

/** The snapshot as a whole: entries by vault path, empty before the first sync. */
export type SyncSnapshot = ReadonlyMap<VaultPath, SnapshotEntry>;
