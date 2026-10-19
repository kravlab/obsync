/**
 * The folder holding `path`, for Remote and vault paths alike, which both
 * use "/" and no leading slash; "" for a path at the top.
 */
export function parentOf(path: string): string {
	const slash = path.lastIndexOf("/");
	return slash === -1 ? "" : path.slice(0, slash);
}
