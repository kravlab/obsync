/**
 * The shared start and end of several sequences: lines of a merge's
 * versions, or characters of an editor's old and new text.
 */

/** How many items a sequence's ends share with the others'. */
export interface CommonEnds {
	/** Items every sequence starts with. */
	readonly head: number;
	/** Items every sequence ends with, after the head, so the two never overlap. */
	readonly tail: number;
}

/** The common start and end of `sequences`, compared item by item. */
export function commonEnds<T>(sequences: readonly ArrayLike<T>[]): CommonEnds {
	const [first] = sequences;
	if (first === undefined) return { head: 0, tail: 0 };
	const shortest = Math.min(...sequences.map((sequence) => sequence.length));
	let head = 0;
	while (head < shortest && sequences.every((sequence) => sequence[head] === first[head])) head += 1;
	let tail = 0;
	/** The item `tail` places before the end of `sequence`. */
	const fromEnd = (sequence: ArrayLike<T>): T | undefined => sequence[sequence.length - 1 - tail];
	while (tail < shortest - head && sequences.every((sequence) => fromEnd(sequence) === fromEnd(first))) tail += 1;
	return { head, tail };
}
