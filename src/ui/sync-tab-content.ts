import type { ShownSync, SyncTab } from "./sync-window";

/**
 * What the Sync window's `tab` body is drawn from, as text, so two draws
 * compare by value: the engine reports a fresh, often equal, list after
 * every sync, and redrawing an unchanged body would lose its focus and
 * cost a full rebuild of a long Skipped or Activity list.
 */
export function tabContent(shown: ShownSync, tab: SyncTab): string {
	const data: Record<SyncTab, unknown> = { conflicts: shown.conflicts, skipped: shown.skipped, activity: shown.activity };
	return JSON.stringify(data[tab]);
}
