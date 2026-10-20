/**
 * Conflict copy names (spec, "Text merge", Conflict copy name; "Binary
 * conflicts"). A Conflict copy keeps this device's version of a file that
 * could not be merged, next to the original, as
 * `Name (conflict <device name> YYYY-MM-DD HHmm).ext`. The name is the only
 * thing that marks a copy, so every device can list copies by it.
 */
import type { VaultPath } from "./local-vault";
import { nameOf, parentOf, splitName } from "./paths";

/**
 * Characters a file name cannot hold on some platform or provider, and
 * control characters: a device name is free text, and `/` would even make
 * a folder.
 */
// eslint-disable-next-line no-control-regex -- control characters are exactly what is replaced
const UNSAFE_IN_NAME = /[\\/:*?"<>|\u0000-\u001f\u007f]/g;

/**
 * A Conflict copy's own name: a name, then the parenthesised suffix with
 * a device name, the date, the time and an optional number, then an
 * optional extension without dots.
 */
const COPY_NAME = /^.+ \(conflict .+ \d{4}-\d{2}-\d{2} \d{4}(?: \d+)?\)(?:\.[^.]*)?$/;

/**
 * The path of a Conflict copy of `path`, in the same folder, made by the
 * device `deviceName` at `time` (ms since the epoch), shown in the device
 * clock's local time. The name is split at the last dot of the file's own
 * name; a name without one, or whose only dot starts it, has no
 * extension. Characters a file name cannot hold in the device name become
 * `-`. `number`, from 2, tells copies apart whose names would otherwise be
 * the same; the first copy has none.
 */
export function conflictCopyPath(path: VaultPath, deviceName: string, time: number, number = 1): VaultPath {
	const { stem, extension } = splitName(nameOf(path));
	const device = deviceName.replace(UNSAFE_IN_NAME, "-");
	const suffix = number > 1 ? ` ${number}` : "";
	const copyName = `${stem} (conflict ${device} ${localTimestamp(time)}${suffix})${extension}`;
	const folder = parentOf(path);
	return folder === "" ? copyName : `${folder}/${copyName}`;
}

/** Whether the file at `path` is a Conflict copy, told by its own name only. */
export function isConflictCopy(path: VaultPath): boolean {
	return COPY_NAME.test(nameOf(path));
}

/** `time` as `YYYY-MM-DD HHmm` in the local time zone. */
function localTimestamp(time: number): string {
	const date = new Date(time);
	const pad = (value: number): string => String(value).padStart(2, "0");
	const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
	return `${day} ${pad(date.getHours())}${pad(date.getMinutes())}`;
}
