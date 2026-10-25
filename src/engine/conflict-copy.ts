/**
 * Conflict copy names (spec, "Text merge", Conflict copy name; "Binary
 * conflicts"). A Conflict copy keeps this device's version of a file that
 * could not be merged, next to the original, as
 * `Name (conflict <device name> YYYY-MM-DD HHmm).ext`. The name is the only
 * thing that marks a copy, so every device can list copies by it.
 */
import type { VaultPath } from "./local-vault";
import { localDateTime } from "./local-time";
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
 *
 * With `maxNameLength`, the provider's longest name in UTF-16 units as its
 * name rules count it, a longer copy name is cut to fit (spec of the review
 * fixes, item 7): the original stem first, down to one character, then
 * the device name, down to one character, and last the extension, from
 * its end, with its dot once nothing is left of it; the date stays whole.
 * Characters are cut as the user sees them (grapheme clusters), never
 * half of one. A name that still does not fit is given as it is, for the
 * caller to find unstorable.
 */
export function conflictCopyPath(
	path: VaultPath,
	deviceName: string,
	time: number,
	number = 1,
	maxNameLength = Number.POSITIVE_INFINITY,
): VaultPath {
	const { stem, extension } = splitName(nameOf(path));
	const stemCharacters = graphemesOf(stem);
	const deviceCharacters = graphemesOf(deviceName.replace(UNSAFE_IN_NAME, "-"));
	const extensionCharacters = graphemesOf(extension.slice(1));
	const stamp = ` ${localTimestamp(time)}${number > 1 ? ` ${number}` : ""})`;
	/** The copy name of the stem, device name and extension as cut so far. */
	const copyName = (): string => {
		const ending = extensionCharacters.length === 0 ? "" : `.${extensionCharacters.join("")}`;
		return `${stemCharacters.join("")} (conflict ${deviceCharacters.join("")}${stamp}${ending}`;
	};
	while (copyName().length > maxNameLength && stemCharacters.length > 1) stemCharacters.pop();
	while (copyName().length > maxNameLength && deviceCharacters.length > 1) deviceCharacters.pop();
	while (copyName().length > maxNameLength && extensionCharacters.length > 0) extensionCharacters.pop();
	const folder = parentOf(path);
	return folder === "" ? copyName() : `${folder}/${copyName()}`;
}

/** The characters of `text` as the user sees them: its grapheme clusters. */
function graphemesOf(text: string): string[] {
	return Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text), (part) => part.segment);
}

/** Whether the file at `path` is a Conflict copy, told by its own name only. */
export function isConflictCopy(path: VaultPath): boolean {
	return COPY_NAME.test(nameOf(path));
}

/** `time` as `YYYY-MM-DD HHmm` in the local time zone. */
function localTimestamp(time: number): string {
	const { day, hours, minutes } = localDateTime(time);
	return `${day} ${hours}${minutes}`;
}
