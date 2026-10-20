/**
 * The post-edit pause as it holds back writes (spec, "Sync triggers and
 * lifecycle"): the note being typed in is not written by a sync until the
 * post-edit pause has passed since its last keystroke.
 */
import type { LocalVault, VaultPath } from "./local-vault";
import type { Clock } from "./ports";

/**
 * Milliseconds left in the post-edit pause for `path` in `vault`, by `clock`;
 * 0 when `path` is not within `pauseMs` of its last keystroke.
 */
export function postEditPauseRemainingMs(vault: LocalVault, clock: Clock, path: VaultPath, pauseMs: number): number {
	const typed = vault.lastTypedAt(path);
	if (typed === null) return 0;
	return Math.max(0, pauseMs - (clock.now() - typed));
}
