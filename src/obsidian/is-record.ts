/** Whether `value` is a non-null object, whose fields a stored-record parser can read. */
export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
