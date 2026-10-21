/**
 * Parsing of the whole-number settings a user types: the post-edit pause,
 * the polling interval, the Per-request limit and the Deletion guard.
 */

/**
 * The whole number in `typed`, surrounding spaces allowed, if it is one
 * from `min` to `max`; null for anything else, signs, decimals and units
 * included.
 */
export function parseWholeNumber(typed: string, min: number, max: number): number | null {
	const trimmed = typed.trim();
	if (!/^\d+$/.test(trimmed)) return null;
	const value = Number(trimmed);
	return isWholeNumberIn(value, min, max) ? value : null;
}

/** Whether `value` is a whole number from `min` to `max`. */
export function isWholeNumberIn(value: number, min: number, max: number): boolean {
	return Number.isInteger(value) && value >= min && value <= max;
}
