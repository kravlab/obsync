/**
 * The text merge (spec, "Text merge"): a line-based 3-way merge of this
 * device's version and the Remote's against the Base. Without a true Base
 * it is a 2-way merge: common lines appear once and every region where
 * the versions differ becomes a Conflict block, so no side is picked, save
 * the one exception below. Changes that do not overlap, and the same
 * change on both sides, merge without one.
 *
 * Versions are compared and merged with LF line endings and no byte-order
 * mark; the result is written in the local file's style, so a difference
 * only in those is none. Nor is a difference only in whether the file ends
 * with a line break, an empty file and one holding only a line break
 * included: the merge keeps the line break. Against a Base, a side that
 * only changed that line break while the other added lines still differs
 * from it in more, and gets a Conflict block.
 */
import { diff3Merge, diffComm } from "node-diff3";
import { commonEnds } from "./common-ends";
import { LOCAL_MARKER, REMOTE_MARKER, SEPARATOR_MARKER } from "./conflict-blocks";
import { decodeUtf8, hasByteOrderMark } from "./utf8";

/** The versions of one text file a merge takes, as bytes. */
export interface TextVersions {
	/** The content at this device's last sync of the file, or null without a true Base. */
	readonly base: ArrayBuffer | null;
	/** This device's version. */
	readonly local: ArrayBuffer;
	/** The Remote's version. */
	readonly remote: ArrayBuffer;
}

/** The labels of a Conflict block's two sides. */
export interface ConflictLabels {
	/** This device's name. */
	readonly local: string;
	/** The other device's name, or `Remote`. */
	readonly remote: string;
}

/** The result of a text merge. */
export interface MergedText {
	/** The merged bytes for both sides. */
	readonly data: ArrayBuffer;
	/**
	 * Whether the merge wrote a Conflict block. Old markers merged as plain
	 * lines do not count: a JSON file is merged cleanly only without one.
	 */
	readonly conflicted: boolean;
}

/**
 * Merges the versions of a text file into the bytes for both sides,
 * labelling any Conflict block with `labels`; null, merging nothing, when
 * a version is not UTF-8. Old
 * markers in the versions are plain lines, so blocks may nest.
 */
export function mergeText(versions: TextVersions, labels: ConflictLabels): MergedText | null {
	const localText = normalised(versions.local);
	const remoteText = normalised(versions.remote);
	const baseText = versions.base === null ? undefined : normalised(versions.base);
	if (localText === null || remoteText === null || baseText === null) return null;
	const local = linesOf(localText);
	const remote = linesOf(remoteText);
	const base = baseText === undefined ? null : linesOf(baseText);
	const merged: string[] = [];
	let conflicted = false;
	const all = regions(base, local, remote);
	for (const [index, region] of all.entries()) {
		/** Whether nothing but empty runs of common lines follows: the region ends the file. */
		const endsFile = all.slice(index + 1).every((later) => "same" in later && later.same.length === 0);
		if ("same" in region) {
			merged.push(...region.same);
		} else if (endsFile && sameOnceClosed(region.local, region.remote)) {
			// The sides differ only in whether the file ends with a line break: no conflict, kept with it.
			merged.push(...closedAtEnd(region.local));
		} else {
			merged.push(...conflictBlock(region.local, region.remote, labels));
			conflicted = true;
		}
	}
	return { data: inStyleOf(versions.local, merged.join("")), conflicted };
}

/** `data` as text with LF line endings and no byte-order mark, or null if it is not UTF-8. */
function normalised(data: ArrayBuffer): string | null {
	return decodeUtf8(data)?.replace(/\r\n/g, "\n") ?? null;
}

/**
 * `text`, merged with LF line endings, as bytes in the style of the file
 * `local`: with its byte-order mark, and with CRLF line endings when most
 * of its line breaks are CRLF.
 */
function inStyleOf(local: ArrayBuffer, text: string): ArrayBuffer {
	const bom = hasByteOrderMark(local) ? "\uFEFF" : "";
	const raw = decodeUtf8(local) ?? "";
	const crlf = raw.match(/\r\n/g)?.length ?? 0;
	const lf = (raw.match(/\n/g)?.length ?? 0) - crlf;
	return encode(bom + (crlf > lf ? text.replace(/\n/g, "\r\n") : text));
}

/** A run of merged lines, or the two sides of a conflict. */
type Region = { readonly same: readonly string[] } | { readonly local: readonly string[]; readonly remote: readonly string[] };

/**
 * The regions of a 3-way merge against `base`, or of a 2-way merge
 * without one. The lines every version shares at its start and end are
 * kept out of the diff, so edits close together in a long note diff only
 * the lines between them. node-diff3 is patched (patches/) to search its
 * LCS candidates in halves instead of one by one, which made the diff
 * about quadratic (node-diff3 issue #84): edits far apart stay fast too.
 */
function regions(base: string[] | null, local: string[], remote: string[]): Region[] {
	const { head, tail } = commonEnds(base === null ? [local, remote] : [local, base, remote]);
	const middle = (lines: string[]): string[] => lines.slice(head, lines.length - tail);
	const merged = middleRegions(base === null ? null : middle(base), middle(local), middle(remote));
	return [{ same: local.slice(0, head) }, ...merged, { same: local.slice(local.length - tail) }];
}

/** The regions of `regions`, diffing every line given. */
function middleRegions(base: string[] | null, local: string[], remote: string[]): Region[] {
	if (base === null) {
		return diffComm(local, remote).map((region) =>
			region.common === undefined ? { local: region.buffer1, remote: region.buffer2 } : { same: region.common },
		);
	}
	return diff3Merge(local, base, remote).map((region) =>
		region.conflict === undefined ? { same: region.ok ?? [] } : { local: region.conflict.a, remote: region.conflict.b },
	);
}

/**
 * The lines of a Conflict block in git's syntax: this device's side, then
 * the Remote's, each closed with a line break so a marker always starts a
 * line.
 */
function conflictBlock(local: readonly string[], remote: readonly string[], labels: ConflictLabels): string[] {
	return [
		`${LOCAL_MARKER} ${labels.local}\n`,
		...closed(local),
		`${SEPARATOR_MARKER}\n`,
		...closed(remote),
		`${REMOTE_MARKER} ${labels.remote}\n`,
	];
}

/** Whether `local` and `remote`, the last lines of a file, are the same once each ends with a line break. */
function sameOnceClosed(local: readonly string[], remote: readonly string[]): boolean {
	const [left, right] = [closedAtEnd(local), closedAtEnd(remote)];
	return left.length === right.length && left.every((line, index) => line === right[index]);
}

/**
 * `lines`, the last lines of a file, ending with a line break: an empty
 * end, as an empty file has, becomes one empty line, so "" and "\n" are
 * the same once closed.
 */
function closedAtEnd(lines: readonly string[]): string[] {
	return closed(lines.length === 0 ? [""] : lines);
}

/** `lines` with a line break added to the last one if it has none. */
function closed(lines: readonly string[]): string[] {
	const last = lines[lines.length - 1];
	return last === undefined || last.endsWith("\n") ? [...lines] : [...lines.slice(0, -1), `${last}\n`];
}

/** The lines of `text`, each with its line break; the last may have none. */
function linesOf(text: string): string[] {
	return text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

/** `text` as UTF-8 bytes in a fresh ArrayBuffer. */
function encode(text: string): ArrayBuffer {
	const encoded = new TextEncoder().encode(text);
	return encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength);
}
