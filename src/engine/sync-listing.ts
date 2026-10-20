/**
 * The two listings one sync compares, narrowed to the paths it may sync
 * and both in vault paths (spec, "Remote layout and change detection").
 *
 * On a case-insensitive provider, paths that differ only by case address
 * one entry, so they are matched by a folded key: a Remote entry takes the
 * vault path of the vault entry it matches, and an unmatched one its
 * parent's vault path plus its own name. The rest of the sync then works
 * in vault paths alone, every provider call addresses the Remote entry it
 * means, and each side keeps the case it has. Paths are folded with
 * `toLowerCase`, as Dropbox's `path_lower` is taken to fold ordinary names.
 *
 * Left out on both sides:
 * - the Metadata folder, which is not part of the mirror, and the
 *   configuration folder, which does not sync until its categories exist;
 * - vault paths that fold to one key, with everything inside them: the
 *   provider can hold only one of them (reporting them is the name policy's
 *   job, later);
 * - every entry below a path that is a file on the other side: syncing it
 *   would need a folder where a file is.
 */
import type { VaultEntry, VaultPath } from "./local-vault";
import { ancestorsOf, foldersDownTo, isWithin, nameOf, parentOf, pathKey } from "./paths";
import type { RemoteEntry, RemotePath } from "./provider";
import { METADATA_FOLDER } from "./remote-metadata";

/** Both sides of one sync, as listed and narrowed; Remote entries carry vault paths. */
export interface SyncListing {
	readonly local: readonly VaultEntry[];
	readonly remote: readonly RemoteEntry[];
}

/** What narrowing the listings depends on besides the listings. */
export interface ListingRules {
	/** The vault's configuration folder. */
	readonly configDir: VaultPath;
	/** Whether the provider treats paths that differ only by case as one. */
	readonly caseInsensitive: boolean;
}

/**
 * Narrows the vault listing `local` and the Remote listing `remote` to the
 * paths a sync may touch, with the Remote entries moved to vault paths.
 */
export function syncListing(
	local: readonly VaultEntry[],
	remote: readonly RemoteEntry[],
	{ configDir, caseInsensitive }: ListingRules,
): SyncListing {
	/** The key paths are matched by. */
	const key = (path: string): string => pathKey(path, caseInsensitive);
	/** Whether `path` lies in a folder that is not synced. */
	const excluded = (path: string): boolean =>
		isWithin(key(path), key(METADATA_FOLDER)) || isWithin(key(path), key(configDir));

	const localKept = local.filter((entry) => !excluded(entry.path));
	const clashing = clashingKeys(localKept.map((entry) => key(entry.path)));
	/** Whether `path`, or a folder holding it, folds to a clashing key. */
	const clashes = (path: string): boolean => foldersDownTo(path).some((folder) => clashing.has(key(folder)));
	const localShown = localKept.filter((entry) => !clashes(entry.path));

	const vaultPaths = new Map(localShown.map((entry) => [key(entry.path), entry.path] as const));
	/** The vault path of the Remote path `path`. */
	const vaultPathOf = (path: RemotePath): VaultPath => {
		const matched = vaultPaths.get(key(path));
		if (matched !== undefined) return matched;
		const parent = parentOf(path);
		return parent === "" ? path : `${vaultPathOf(parent)}/${nameOf(path)}`;
	};
	const remoteShown = remote
		.filter((entry) => !excluded(entry.path) && !clashes(entry.path))
		.map((entry) => ({ ...entry, path: vaultPathOf(entry.path) }));

	const localFiles = filePaths(localShown);
	const remoteFiles = filePaths(remoteShown);
	return {
		local: localShown.filter((entry) => !belowAny(entry.path, remoteFiles)),
		remote: remoteShown.filter((entry) => !belowAny(entry.path, localFiles)),
	};
}

/** The keys that occur more than once in `keys`. */
function clashingKeys(keys: readonly string[]): ReadonlySet<string> {
	const seen = new Set<string>();
	const clashing = new Set<string>();
	for (const key of keys) (seen.has(key) ? clashing : seen).add(key);
	return clashing;
}

/** The paths of the files among `entries`. */
function filePaths(entries: readonly (VaultEntry | RemoteEntry)[]): ReadonlySet<VaultPath> {
	return new Set(entries.filter((entry) => entry.kind === "file").map((entry) => entry.path));
}

/** Whether a folder holding `path` is one of `files`. */
function belowAny(path: VaultPath, files: ReadonlySet<VaultPath>): boolean {
	return ancestorsOf(path).some((folder) => files.has(folder));
}
