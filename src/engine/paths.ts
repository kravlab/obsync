/**
 * Path helpers shared by vault paths and Remote paths, which both use "/"
 * and no leading slash, with "" for the root.
 */

/** The folder holding `path`; "" for a path at the top. */
export function parentOf(path: string): string {
	const slash = path.lastIndexOf("/");
	return slash === -1 ? "" : path.slice(0, slash);
}

/** The folders holding `path`, outermost first, without the root: "a/b/c" gives "a", "a/b". */
export function ancestorsOf(path: string): string[] {
	const segments = path.split("/");
	return segments.slice(1).map((_, index) => segments.slice(0, index + 1).join("/"));
}

/** Whether `path` is `folder` itself or lies inside it. */
export function isWithin(path: string, folder: string): boolean {
	return path === folder || path.startsWith(`${folder}/`);
}

/** An entry moved, or renamed, from one path to another. */
export interface Move {
	readonly from: string;
	readonly to: string;
}

/** Where `path` is once the entry at `from` moved to `to`, taking what is inside it along; `path` itself otherwise. */
export function movedAlong(path: string, from: string, to: string): string {
	return isWithin(path, from) ? to + path.slice(from.length) : path;
}

/** Where `moves`, in order, took `path`, a folder's taking everything inside it. */
export function followMoves(path: string, moves: readonly Move[]): string {
	return moves.reduce((current, { from, to }) => movedAlong(current, from, to), path);
}

/** The folders from the top down to `path` itself, none for the root: "a/b" gives "a", "a/b". */
export function foldersDownTo(path: string): string[] {
	return path === "" ? [] : [...ancestorsOf(path), path];
}

/** The last segment of `path`: its own name. */
export function nameOf(path: string): string {
	return path.slice(path.lastIndexOf("/") + 1);
}

/**
 * A file's own name split at its last dot, which goes with the extension.
 * A name without a dot, or whose only dot starts it (`.hidden`), has the
 * extension "".
 */
export function splitName(name: string): { readonly stem: string; readonly extension: string } {
	const dot = name.lastIndexOf(".");
	return dot > 0 ? { stem: name.slice(0, dot), extension: name.slice(dot) } : { stem: name, extension: "" };
}

/**
 * The key `path` is matched by: folded with `toLowerCase` on a
 * case-insensitive provider, as Dropbox's `path_lower` is taken to fold
 * ordinary names, else the path itself.
 */
export function pathKey(path: string, caseInsensitive: boolean): string {
	return caseInsensitive ? path.toLowerCase() : path;
}

/** Orders paths by code unit, so every folder comes before what it holds. */
export function comparePaths(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}
