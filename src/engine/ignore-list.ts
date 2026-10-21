/**
 * The shared ignore list (spec, "Synced file scope"): path patterns in
 * the Remote settings, the same on every device, in `.gitignore` syntax
 * matched by the `ignore` package against vault paths. A folder pattern
 * (`Archive/`) names folders only, a leading slash (`/Templates`) anchors
 * a pattern to the vault root, `!` takes a path back, and an ignored
 * folder takes everything inside it along, as in Git.
 */
import ignore from "ignore";
import type { VaultPath } from "./local-vault";

/** The compiled ignore list. */
export interface IgnoreList {
	/** Whether the entry at `path`, a file or a folder, matches the list. */
	ignores(path: VaultPath, kind: "file" | "folder"): boolean;
}

/**
 * Compiles `patterns`, matched without case when `caseInsensitive`, as
 * the provider matches paths.
 */
export function ignoreList(patterns: readonly string[], caseInsensitive: boolean): IgnoreList {
	const matcher = ignore({ ignorecase: caseInsensitive }).add(patterns);
	return {
		// Git tells a folder by its trailing slash, so folder patterns pass over files.
		ignores: (path, kind) => matcher.ignores(kind === "folder" ? `${path}/` : path),
	};
}
