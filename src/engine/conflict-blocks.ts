/**
 * Conflict blocks (glossary) in a note's text, and the edit each way of
 * resolving one makes (spec, "Architecture and modules", Conflict-block
 * module). Pure: the editor extension, the reading view and the commands
 * all read blocks through it.
 *
 * A marker line is exactly seven `<`, `=` or `>` at the start of a line,
 * then a space and a label, or the end of the line. A block is
 * `<<<<<<<`, `=======`, `>>>>>>>` in that order, and blocks nest. A marker
 * that does not complete a block is plain text: where the same lines read
 * two ways, a `>>>>>>>` closes the innermost open block that has its
 * `=======`, leaving any opener inside it as text, and an opener never
 * closed takes over the first block inside it. Either way every line stays.
 */

/** The marker opening a Conflict block, before this device's side. */
export const LOCAL_MARKER = "<<<<<<<";

/** The marker between the two sides. */
export const SEPARATOR_MARKER = "=======";

/** The marker closing a Conflict block, after the other device's side. */
export const REMOTE_MARKER = ">>>>>>>";

/** One Conflict block in a note. Lines count from 0. */
export interface ConflictBlock {
	/** The `<<<<<<<` line. */
	readonly startLine: number;
	/** The `=======` line. */
	readonly separatorLine: number;
	/** The `>>>>>>>` line. */
	readonly endLine: number;
	/** The label after `<<<<<<<`: this device's name when the merge wrote it. */
	readonly localLabel: string;
	/** The label after `>>>>>>>`: the other device's name, or `Remote`. */
	readonly remoteLabel: string;
	/** The lines between `<<<<<<<` and `=======`, each with its line break. */
	readonly local: string;
	/** The lines between `=======` and `>>>>>>>`, each with its line break. */
	readonly remote: string;
}

/** A marker line's kind and label. */
interface Marker {
	readonly kind: "<" | "=" | ">";
	readonly label: string;
}

/** The marker on `line` (its text without the line break), or null if it is no marker. */
function markerOf(line: string): Marker | null {
	for (const marker of [LOCAL_MARKER, SEPARATOR_MARKER, REMOTE_MARKER]) {
		if (!line.startsWith(marker)) continue;
		const rest = line.slice(marker.length).replace(/\r$/, "");
		if (rest !== "" && !rest.startsWith(" ")) return null;
		return { kind: marker[0] as Marker["kind"], label: rest.slice(1) };
	}
	return null;
}

/** A block opened by a `<<<<<<<` line and not yet closed. */
interface OpenBlock {
	readonly startLine: number;
	readonly localLabel: string;
	separatorLine?: number;
}

/** The Conflict blocks of `text`, in the order their `<<<<<<<` lines appear. */
export function conflictBlocks(text: string): ConflictBlock[] {
	const lines = linesOf(text);
	/** Blocks opened and not yet closed, innermost last. */
	const open: OpenBlock[] = [];
	const blocks: ConflictBlock[] = [];
	/** The block from `opener` to the `>>>>>>>` at `endLine` labelled `remoteLabel`. */
	const blockOf = (opener: OpenBlock, separatorLine: number, endLine: number, remoteLabel: string): ConflictBlock => ({
		startLine: opener.startLine,
		separatorLine,
		endLine,
		localLabel: opener.localLabel,
		remoteLabel,
		local: lines.slice(opener.startLine + 1, separatorLine).join(""),
		remote: lines.slice(separatorLine + 1, endLine).join(""),
	});
	lines.forEach((line, index) => {
		const marker = markerOf(line.replace(/\n$/, ""));
		if (marker === null) return;
		if (marker.kind === "<") {
			open.push({ startLine: index, localLabel: marker.label });
			return;
		}
		if (marker.kind === "=") {
			const innermost = open[open.length - 1];
			if (innermost !== undefined && innermost.separatorLine === undefined) innermost.separatorLine = index;
			return;
		}
		// A closer ends the innermost block that has its separator; openers inside it were plain text.
		let closing = open.length - 1;
		while (closing >= 0 && open[closing]?.separatorLine === undefined) closing -= 1;
		const opener = open[closing];
		if (opener?.separatorLine === undefined) return;
		open.splice(closing);
		blocks.push(blockOf(opener, opener.separatorLine, index, marker.label));
	});
	// An opener never closed takes over the first block inside it: its markers were the outer block's.
	for (const unclosed of open) {
		if (unclosed.separatorLine !== undefined) continue;
		const inner = blocks
			.filter((block) => block.startLine > unclosed.startLine)
			.sort((a, b) => a.startLine - b.startLine)[0];
		if (inner === undefined) continue;
		blocks.splice(blocks.indexOf(inner), 1, blockOf(unclosed, inner.separatorLine, inner.endLine, inner.remoteLabel));
	}
	return blocks.sort((a, b) => a.startLine - b.startLine);
}

/** The lines of `text`, each with its line break; the last may have none. */
function linesOf(text: string): string[] {
	return text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

/**
 * `shown` as `text` holds it now: the block starting at the same line with
 * the same labels and sides, or null once it moved, changed or is gone.
 * Its place tells it from an identical block elsewhere in the note.
 */
export function findBlock(text: string, shown: ConflictBlock): ConflictBlock | null {
	const found = conflictBlocks(text).find((block) => block.startLine === shown.startLine);
	return found !== undefined && sameContent(found, shown) ? found : null;
}

/** Whether `a` and `b` hold the same labels and sides, wherever they are. */
function sameContent(a: ConflictBlock, b: ConflictBlock): boolean {
	return a.localLabel === b.localLabel && a.remoteLabel === b.remoteLabel && a.local === b.local && a.remote === b.remote;
}

/** Which way to move between Conflict blocks. */
export type BlockDirection = "next" | "previous";

/** A way to resolve a Conflict block. */
export type ConflictAction =
	| { readonly kind: "keepLocal" }
	| { readonly kind: "keepRemote" }
	| { readonly kind: "keepBoth" }
	/** The user's hand edit, which replaces the whole block. */
	| { readonly kind: "replace"; readonly text: string };

/** One change to a note's text: what replaces the characters from `from` up to `to`. */
export interface TextEdit {
	readonly from: number;
	readonly to: number;
	readonly insert: string;
}

/**
 * The edit that resolves `block` of `text` by `action`, replacing the
 * block's lines, markers included, and nothing else. The result ends with
 * a line break exactly when the block did, in the block's own style.
 */
export function resolutionOf(text: string, block: ConflictBlock, action: ConflictAction): TextEdit {
	const lines = linesOf(text);
	const from = lines.slice(0, block.startLine).join("").length;
	const to = from + lines.slice(block.startLine, block.endLine + 1).join("").length;
	const lineBreak = /\r?\n$/.exec(lines[block.endLine] ?? "")?.[0] ?? "";
	const kept = keptText(block, action);
	const bare = kept.replace(/\r?\n$/, "");
	return { from, to, insert: kept === "" ? "" : bare + lineBreak };
}

/** What `action` keeps of `block`, before its last line break is matched to the block's. */
function keptText(block: ConflictBlock, action: ConflictAction): string {
	switch (action.kind) {
		case "keepLocal":
			return block.local;
		case "keepRemote":
			return block.remote;
		case "keepBoth":
			return block.local + block.remote;
		case "replace":
			return action.text;
	}
}

/**
 * The block to move to from `line` among `blocks` (in document order):
 * the first starting after it, or for `previous` the last starting before
 * it, wrapping around at either end; null when there are none.
 */
export function adjacentBlock(
	blocks: readonly ConflictBlock[],
	line: number,
	direction: BlockDirection,
): ConflictBlock | null {
	if (direction === "next") return blocks.find((block) => block.startLine > line) ?? blocks[0] ?? null;
	const before = blocks.filter((block) => block.startLine < line);
	return before[before.length - 1] ?? blocks[blocks.length - 1] ?? null;
}

/** A part of a rendered section: plain note text, or a whole Conflict block to show as one. */
export type SectionPiece =
	| { readonly kind: "text"; readonly text: string }
	| { readonly kind: "block"; readonly block: ConflictBlock };

/**
 * The lines `lineStart` to `lineEnd` of `text`, a section reading view
 * renders on its own, split around the Conflict blocks that touch it: a
 * block starting in the section becomes one piece, the lines of a block
 * that started in an earlier section are dropped, and the rest is text.
 * Only outermost blocks count; a nested one shows as part of its side.
 * Null when no block touches the section, which then needs no change.
 */
export function sectionPieces(text: string, lineStart: number, lineEnd: number): SectionPiece[] | null {
	const outermost = outermostBlocks(conflictBlocks(text));
	const touching = outermost.filter((block) => block.startLine <= lineEnd && block.endLine >= lineStart);
	if (touching.length === 0) return null;
	const lines = linesOf(text);
	const pieces: SectionPiece[] = [];
	let pending = "";
	/** Ends the text piece gathered so far, if any. */
	const flush = (): void => {
		if (pending !== "") pieces.push({ kind: "text", text: pending });
		pending = "";
	};
	for (let line = lineStart; line <= lineEnd; line += 1) {
		const block = touching.find((candidate) => candidate.startLine <= line && line <= candidate.endLine);
		if (block === undefined) pending += lines[line] ?? "";
		else if (block.startLine === line) {
			flush();
			pieces.push({ kind: "block", block });
		}
	}
	flush();
	return pieces;
}

/** The blocks of `blocks` that no other block holds. */
function outermostBlocks(blocks: readonly ConflictBlock[]): ConflictBlock[] {
	return blocks.filter(
		(block) => !blocks.some((other) => other.startLine < block.startLine && block.endLine < other.endLine),
	);
}
