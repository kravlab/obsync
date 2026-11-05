/**
 * The two listings one sync compares, narrowed to the paths it may sync
 * and both in vault paths (spec, "Remote layout and change detection",
 * "Synced file scope").
 *
 * On a case-insensitive provider, paths that differ only by case address
 * one entry, so they are matched by a folded key: a Remote entry takes the
 * vault path of the vault entry it matches, else the Sync snapshot's path
 * it matches (a file deleted here keeps the path it was synced under), and
 * an unmatched one its parent's vault path plus its own name. The rest of the sync then works
 * in vault paths alone, every provider call addresses the Remote entry it
 * means, and each side keeps the case it has. Paths are folded with
 * `toLowerCase`, as Dropbox's `path_lower` is taken to fold ordinary names.
 *
 * Left out on both sides, with everything inside them:
 * - hidden paths, any segment of which starts with a dot: the Metadata
 *   folder, `.git`, `.DS_Store` and the like. They never sync and are not
 *   reported. The configuration folder, whatever its name, is the
 *   exception: each entry in it syncs only while a category it belongs to
 *   is on (configuration.ts), and is left out unreported otherwise;
 * - paths the shared ignore list matches (`ignored`);
 * - paths the provider cannot store under the Remote's name policy
 *   (`nameNotRepresentable`);
 * - vault paths that fold to one key, which the provider can hold only one
 *   of (`caseClash`); a variant above the size ceiling does not count, so
 *   the one variant under it still syncs;
 * - files above the size ceiling on either side (`tooLarge`).
 * A path left out for one side's entry is left out on the other side too,
 * so neither version is written over the other. Each file left out for
 * these four reasons is reported in `skipped`, once, with the first reason
 * in that order.
 *
 * Also left out, unreported: every entry below a path that is a file on
 * the other side, since syncing it would need a folder where a file is.
 *
 * A path left out is not gone: `goneLocally` and `goneRemotely` tell a
 * side that no longer has a path at all, so the deletion rules never take
 * a path left out here for a deleted one.
 */
import type { IgnoreList } from "./ignore-list";
import type { VaultEntry, VaultPath } from "./local-vault";
import { ancestorsOf, comparePaths, foldersDownTo, nameOf, parentOf, pathKey } from "./paths";
import type { RemoteEntry, RemotePath } from "./provider";

/** Both sides of one sync, as listed and narrowed; Remote entries carry vault paths. */
export interface SyncListing {
	readonly local: readonly VaultEntry[];
	readonly remote: readonly RemoteEntry[];
	/** Whether the vault listing has no entry at `path`, matched as the provider matches paths. */
	goneLocally(path: VaultPath): boolean;
	/** Whether the Remote listing has no entry at `path`, matched as the provider matches paths. */
	goneRemotely(path: VaultPath): boolean;
	/** The files left out for a reason the user is told, ordered by path. */
	readonly skipped: readonly SkippedFile[];
}

/** Why a file does not sync. */
export type SkipReason = "ignored" | "nameNotRepresentable" | "caseClash" | "tooLarge";

/** A file left out of sync, at its vault path, and why. */
export interface SkippedFile {
	readonly path: VaultPath;
	readonly reason: SkipReason;
}

/** What narrowing the listings depends on besides the listings: the Synced file scope rules. */
export interface ListingRules {
	/**
	 * Whether the entry of `kind` at `path` in the configuration folder
	 * syncs, by this device's categories; null for a path outside it, which
	 * the other rules decide. `Vault.configDir` does not promise the folder
	 * starts with a dot, so it is asked before the hidden rule.
	 */
	readonly configuration: (path: VaultPath, kind: VaultEntry["kind"]) => boolean | null;
	/** Whether the provider treats paths that differ only by case as one. */
	readonly caseInsensitive: boolean;
	/** The shared ignore list. */
	readonly ignore: IgnoreList;
	/** Whether the provider can store the vault path `path` under the Remote's name policy. */
	readonly storable: (path: VaultPath) => boolean;
	/** Files larger than this many bytes do not sync. */
	readonly sizeCeiling: number;
}

/**
 * Narrows the vault listing `local` and the Remote listing `remote` to the
 * paths a sync may touch, with the Remote entries moved to vault paths;
 * `syncedPaths`, the Sync snapshot's paths, name Remote entries the vault
 * no longer has.
 */
export function syncListing(
	local: readonly VaultEntry[],
	remote: readonly RemoteEntry[],
	rules: ListingRules,
	syncedPaths: Iterable<VaultPath> = [],
): SyncListing {
	const { caseInsensitive } = rules;
	/** The key paths are matched by. */
	const key = (path: string): string => pathKey(path, caseInsensitive);

	/** Whether `entry` never syncs and is not reported: hidden, or in the configuration folder in no category that is on. */
	const unsynced = (entry: VaultEntry | RemoteEntry): boolean =>
		!(rules.configuration(entry.path, entry.kind) ?? !isHidden(entry.path));
	/** Whether `entry` is a file above the size ceiling. */
	const tooLarge = (entry: VaultEntry | RemoteEntry): boolean => entry.kind === "file" && entry.size > rules.sizeCeiling;
	const visible = local.filter((entry) => !unsynced(entry));
	// A case variant above the ceiling never syncs, so it does not clash with one that can.
	const syncableKeys = new Set(visible.filter((entry) => !tooLarge(entry)).map((entry) => key(entry.path)));
	const shadowed = visible.filter((entry) => tooLarge(entry) && syncableKeys.has(key(entry.path)));
	const shadowedPaths = new Set(shadowed.map((entry) => entry.path));
	const localKept = visible.filter((entry) => !shadowedPaths.has(entry.path));
	const clashing = clashingKeys(localKept.map((entry) => key(entry.path)));
	/** Whether `path`, or a folder holding it, folds to a clashing key. */
	const clashes = (path: string): boolean => foldersDownTo(path).some((folder) => clashing.has(key(folder)));

	const vaultPaths = new Map(localKept.filter((entry) => !clashes(entry.path)).map((entry) => [key(entry.path), entry.path] as const));
	for (const path of syncedPaths) {
		if (!vaultPaths.has(key(path)) && !clashes(path)) vaultPaths.set(key(path), path);
	}
	/** The vault path of the Remote path `path`. */
	const vaultPathOf = (path: RemotePath): VaultPath => {
		const matched = vaultPaths.get(key(path));
		if (matched !== undefined) return matched;
		const parent = parentOf(path);
		return parent === "" ? path : `${vaultPathOf(parent)}/${nameOf(path)}`;
	};
	const remoteKept = remote.filter((entry) => !unsynced(entry)).map((entry) => ({ ...entry, path: vaultPathOf(entry.path) }));

	/** Why `entry` does not sync, or null when it does as far as it alone tells. */
	const reasonOf = (entry: VaultEntry | RemoteEntry): SkipReason | null => {
		if (rules.ignore.ignores(entry.path, entry.kind)) return "ignored";
		if (!rules.storable(entry.path)) return "nameNotRepresentable";
		if (clashes(entry.path)) return "caseClash";
		if (tooLarge(entry)) return "tooLarge";
		return null;
	};
	/** The keys of the entries left out. */
	const leftOut = new Set<string>();
	/**
	 * The files left out: every vault one, so each path of a case clash,
	 * then the Remote ones at keys the vault has none left out at.
	 */
	const skipped: SkippedFile[] = shadowed.map((entry) => ({ path: entry.path, reason: "tooLarge" }));
	for (const [index, entry] of [...localKept, ...remoteKept].entries()) {
		const reason = reasonOf(entry);
		if (reason === null) continue;
		const fromVault = index < localKept.length;
		if (entry.kind === "file" && (fromVault || !leftOut.has(key(entry.path)))) skipped.push({ path: entry.path, reason });
		leftOut.add(key(entry.path));
	}
	/** Whether `path`, or a folder holding it, is left out. */
	const excluded = (path: string): boolean => foldersDownTo(path).some((folder) => leftOut.has(key(folder)));
	const localShown = localKept.filter((entry) => !excluded(entry.path));
	const remoteShown = remoteKept.filter((entry) => !excluded(entry.path));

	const localFiles = filePaths(localShown);
	const remoteFiles = filePaths(remoteShown);
	const localKeys = new Set(local.map((entry) => key(entry.path)));
	const remoteKeys = new Set(remote.map((entry) => key(entry.path)));
	return {
		local: localShown.filter((entry) => !belowAny(entry.path, remoteFiles)),
		remote: remoteShown.filter((entry) => !belowAny(entry.path, localFiles)),
		goneLocally: (path) => !localKeys.has(key(path)),
		goneRemotely: (path) => !remoteKeys.has(key(path)),
		skipped: skipped.sort((a, b) => comparePaths(a.path, b.path)),
	};
}

/** Whether a segment of `path` starts with a dot, which hides it. */
function isHidden(path: string): boolean {
	return path.split("/").some((segment) => segment.startsWith("."));
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
