/**
 * The text merge (spec, "Text merge"): a line-based 3-way merge of this
 * device's version and the Remote's against the Base. Without a true Base
 * it is a 2-way merge: common lines appear once and every region where
 * the versions differ becomes a Conflict block, so no side is picked.
 * Changes that do not overlap, and the same change on both sides, merge
 * without one.
 *
 * Versions are compared and merged with LF line endings and no byte-order
 * mark; the result is written in the local file's style, so a difference
 * only in those is none.
 */
import { diff3Merge, diffComm } from "node-diff3";
import { commonEnds } from "./common-ends";
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

/**
 * Merges the versions of a text file into the bytes for both sides,
 * labelling any Conflict block with `labels`; null, merging nothing, when
 * a version is not UTF-8. Old
 * markers in the versions are plain lines, so blocks may nest.
 */
export function mergeText(versions: TextVersions, labels: ConflictLabels): ArrayBuffer | null {
	const localText = normalised(versions.local);
	const remoteText = normalised(versions.remote);
	const baseText = versions.base === null ? undefined : normalised(versions.base);
	if (localText === null || remoteText === null || baseText === null) return null;
	const local = linesOf(localText);
	const remote = linesOf(remoteText);
	const base = baseText === undefined ? null : linesOf(baseText);
	const merged: string[] = [];
	for (const region of regions(base, local, remote)) {
		if ("same" in region) merged.push(...region.same);
		else merged.push(...conflictBlock(region.local, region.remote, labels));
	}
	return inStyleOf(versions.local, merged.join(""));
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
 * kept out of the diff, whose cost grows about with the square of the
 * lines it compares (node-diff3 issue #84): edits close together in a long
 * note stay fast.
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
	return [`<<<<<<< ${labels.local}\n`, ...closed(local), "=======\n", ...closed(remote), `>>>>>>> ${labels.remote}\n`];
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
