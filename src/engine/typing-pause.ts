/**
 * The typing pause (spec, "Sync triggers and lifecycle"): the note being
 * typed in is not written by a sync until the user has paused.
 */
import type { LocalVault, VaultPath } from "./local-vault";
import type { Clock } from "./ports";

/**
 * How long after the last keystroke a note open in an editor is left
 * alone, in ms; ticket 05 makes it a setting.
 */
export const TYPING_PAUSE_MS = 2000;

/** Whether the user typed into `path` in `vault` within the typing pause, by `clock`. */
export function isBeingTyped(vault: LocalVault, clock: Clock, path: VaultPath): boolean {
	const typed = vault.lastTypedAt(path);
	return typed !== null && clock.now() - typed < TYPING_PAUSE_MS;
}
