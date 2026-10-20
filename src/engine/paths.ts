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

/** The folders from the top down to `path` itself, none for the root: "a/b" gives "a", "a/b". */
export function foldersDownTo(path: string): string[] {
	return path === "" ? [] : [...ancestorsOf(path), path];
}

/** The last segment of `path`: its own name. */
export function nameOf(path: string): string {
	return path.slice(path.lastIndexOf("/") + 1);
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
