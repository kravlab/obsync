/** A moment in the local time zone, as the parts names and messages show. */
export interface LocalDateTime {
	/** `YYYY-MM-DD`. */
	readonly day: string;
	/** `HH`, 00 to 23. */
	readonly hours: string;
	/** `MM`, 00 to 59. */
	readonly minutes: string;
}

/** `time`, in ms since the epoch, in the local time zone. */
export function localDateTime(time: number): LocalDateTime {
	const date = new Date(time);
	const pad = (value: number): string => String(value).padStart(2, "0");
	return {
		day: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
		hours: pad(date.getHours()),
		minutes: pad(date.getMinutes()),
	};
}
