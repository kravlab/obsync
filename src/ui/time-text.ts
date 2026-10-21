import { localDateTime } from "../engine/local-time";

/** `time`, in ms since the epoch, as lists show it: `YYYY-MM-DD HH:MM` in the local time zone. */
export function timeText(time: number): string {
	const { day, hours, minutes } = localDateTime(time);
	return `${day} ${hours}:${minutes}`;
}
