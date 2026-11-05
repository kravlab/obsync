/**
 * Finding renames (spec, "Deletions and renames"): a path the Sync
 * snapshot records that a side no longer has, and a path that side has
 * now and the snapshot does not, are one entry renamed when
 * - here: the vault's `rename` events say so;
 * - on the Remote: the entry carries the stable id the snapshot recorded;
 * - on either side, for a file: it is the only new file there with the
 *   content the snapshot records, and the only vanished file with that
 *   content;
 * - for a folder: every file the snapshot records inside it was renamed
 *   to the same place inside one new folder on that side.
 *
 * Anything else, an ambiguous match included, stays a deletion plus a new
 * entry (deletions.ts).
 *
 * A folder rename is carried as one move only: on the Remote with the
 * folder move Capability, in the vault with one `vault.rename`, and only
 * when the new path is free there and every entry the snapshot records
 * inside the folder is renamed along with it, so the other side's own
 * changes inside it keep their rules. Any other folder rename is left to
 * the deletion rules, which remove the old folder once its files went,
 * while the new one is created as any new folder; the files inside are
 * still carried as renames.
 *
 * On a case-insensitive provider, a vault path whose name changed only in
 * case is not gone (sync-listing.ts): the snapshot only follows it to the
 * new case, and the Remote keeps its own.
 */
import type { VaultEntry, VaultPath } from "./local-vault";
import { followMoves, isWithin, movedAlong, pathKey, type Move } from "./paths";
import type { RemoteEntry } from "./provider";
import type { SyncListing } from "./sync-listing";
import type { SyncSnapshot } from "./sync-snapshot";

/** A rename the vault reported, in the order it happened. */
export type VaultRename = Move;

/** What finding renames reads besides the listings. */
export interface RenameChecks {
	/** The content hash of the vault file `path`. */
	localHash(path: VaultPath): Promise<string>;
	/**
	 * The content hash of the Remote file `path` and the revision of the
	 * bytes hashed; null when it is gone.
	 */
	remoteContent(path: VaultPath): Promise<{ readonly hash: string; readonly revision: string } | null>;
}

/** What finding renames depends on besides the listings. */
export interface RenameRules {
	/** Whether the provider treats paths that differ only by case as one. */
	readonly caseInsensitive: boolean;
	/** Whether the provider moves folders (the folder move Capability). */
	readonly folderMove: boolean;
}

/** A snapshot entry found at a new path on one side. */
export interface Rename {
	readonly kind: "file" | "folder";
	/** The path the Sync snapshot records. */
	readonly from: VaultPath;
	/** The path the entry has now. */
	readonly to: VaultPath;
}

/**
 * A rename found on the Remote. `revision`, when known, is a revision of
 * the Remote file at `to` that holds the content the snapshot records.
 */
export interface RemoteRename extends Rename {
	readonly revision?: string;
}

/** A snapshot entry renamed on both sides, to different paths. */
export interface RenamedOnBoth {
	readonly kind: "file" | "folder";
	readonly from: VaultPath;
	/** Its new path in the vault. */
	readonly vaultPath: VaultPath;
	/** Its rename on the Remote, whose name wins. */
	readonly remote: RemoteRename;
}

/** What one sync does about the snapshot's paths renamed on a side. */
export interface Renames {
	/** Renamed here only: carried to the Remote. */
	readonly toRemote: readonly Rename[];
	/** Renamed on the Remote only: carried to the vault. */
	readonly toVault: readonly RemoteRename[];
	/** Renamed to the same path on both sides: only recorded there. */
	readonly sameOnBoth: readonly RemoteRename[];
	/** Renamed differently on both sides: the vault takes the Remote's name. */
	readonly differentOnBoth: readonly RenamedOnBoth[];
	/** Renamed here, deleted on the Remote: kept, as a new entry, under the new name. */
	readonly keptHere: readonly Rename[];
	/** Renamed on the Remote, deleted here: kept, as a new entry, under the new name. */
	readonly keptThere: readonly Rename[];
	/** Every snapshot path these renames account for, which the deletion rules leave alone. */
	readonly paths: ReadonlySet<VaultPath>;
}

/**
 * Finds the renames between `snapshot` and both sides of `listing`, with
 * `hints`, the vault's renames since the last completed sync, in order.
 */
export async function findRenames(
	snapshot: SyncSnapshot,
	listing: SyncListing,
	hints: readonly VaultRename[],
	checks: RenameChecks,
	rules: RenameRules,
): Promise<Renames> {
	const here = await renamedHere(snapshot, listing, hints, checks);
	const there = await renamedThere(snapshot, listing, checks);
	return classify(snapshot, listing, here, there, caseRenames(snapshot, listing, rules), rules);
}

/** One side's entries as finding renames sees them. */
interface Side {
	/** Every entry the side lists, by vault path. */
	readonly entries: ReadonlyMap<VaultPath, VaultEntry | RemoteEntry>;
	/** Whether the side has no entry at `path`, matched as the provider matches paths. */
	gone(path: VaultPath): boolean;
}

/** The snapshot's entries the vault has at another path now, by snapshot path. */
async function renamedHere(
	snapshot: SyncSnapshot,
	listing: SyncListing,
	hints: readonly VaultRename[],
	checks: RenameChecks,
): Promise<Map<VaultPath, Rename>> {
	const side: Side = { entries: byPath(listing.local), gone: (path) => listing.goneLocally(path) };
	const found = new Map<VaultPath, RemoteRename>();
	/** How many snapshot entries the hints take to each path: two or more leave no hint saying which one is there. */
	const arrivals = new Map<VaultPath, number>();
	for (const [from, synced] of snapshot) {
		if (!side.gone(from)) continue;
		const to = followMoves(from, hints);
		if (to === from || !isNewAt(side, synced.kind, to, snapshot)) continue;
		arrivals.set(to, (arrivals.get(to) ?? 0) + 1);
		found.set(from, { kind: synced.kind, from, to });
	}
	for (const [from, { to }] of [...found]) if ((arrivals.get(to) ?? 0) > 1) found.delete(from);
	await matchByContent(snapshot, side, found, async (path) => ({ hash: await checks.localHash(path) }));
	addDerivedFolders(snapshot, side, found);
	return found;
}

/** The snapshot's entries the Remote has at another path now, by snapshot path. */
async function renamedThere(
	snapshot: SyncSnapshot,
	listing: SyncListing,
	checks: RenameChecks,
): Promise<Map<VaultPath, RemoteRename>> {
	const side: Side = { entries: byPath(listing.remote), gone: (path) => listing.goneRemotely(path) };
	const byId = new Map<string, RemoteEntry>();
	for (const entry of listing.remote) {
		if (entry.stableId !== undefined && !snapshot.has(entry.path)) byId.set(entry.stableId, entry);
	}
	const found = new Map<VaultPath, RemoteRename>();
	for (const [from, synced] of snapshot) {
		if (!side.gone(from) || synced.stableId === undefined) continue;
		const entry = byId.get(synced.stableId);
		if (entry?.kind !== synced.kind) continue;
		const sameRevision = entry.kind === "file" && synced.kind === "file" && entry.revision === synced.revision;
		found.set(from, { kind: synced.kind, from, to: entry.path, ...(sameRevision ? { revision: entry.revision } : {}) });
	}
	await matchByContent(snapshot, side, found, (path) => checks.remoteContent(path));
	addDerivedFolders(snapshot, side, found);
	return found;
}

/**
 * Adds to `found` each file of `snapshot` that `side` no longer has and
 * no rename found accounts for, when it is the only such file with its
 * content and exactly one new file of `side` has that content, read
 * through `contentOf`; its revision, when given, holds that content. Only
 * new files of a vanished file's size are read, every one of them when a
 * vanished file's size is not recorded.
 */
async function matchByContent(
	snapshot: SyncSnapshot,
	side: Side,
	found: Map<VaultPath, RemoteRename>,
	contentOf: (path: VaultPath) => Promise<{ readonly hash: string; readonly revision?: string } | null>,
): Promise<void> {
	const vanished = new Map<string, { readonly from: VaultPath; readonly size?: number } | null>();
	for (const [from, synced] of snapshot) {
		if (synced.kind !== "file" || found.has(from) || !side.gone(from)) continue;
		// A second vanished file with the same content makes both ambiguous.
		vanished.set(synced.hash, vanished.has(synced.hash) ? null : { from, size: synced.size });
	}
	const unique = [...vanished].filter((item): item is [string, { from: VaultPath; size?: number }] => item[1] !== null);
	if (unique.length === 0) return;
	const sizes = new Set(unique.map(([, { size }]) => size));
	const taken = new Set([...found.values()].map(({ to }) => to));
	const matches = new Map<string, { readonly to: VaultPath; readonly revision?: string }[]>();
	for (const entry of side.entries.values()) {
		if (entry.kind !== "file" || snapshot.has(entry.path) || taken.has(entry.path)) continue;
		if (!sizes.has(undefined) && !sizes.has(entry.size)) continue;
		const content = await contentOf(entry.path);
		if (content === null) continue;
		const list = matches.get(content.hash) ?? [];
		list.push({ to: entry.path, ...(content.revision === undefined ? {} : { revision: content.revision }) });
		matches.set(content.hash, list);
	}
	for (const [hash, { from }] of unique) {
		const candidates = matches.get(hash);
		if (candidates?.length !== 1) continue;
		const [match] = candidates;
		if (match !== undefined) found.set(from, { kind: "file", from, ...match });
	}
}

/**
 * Adds to `found` each folder of `snapshot` that `side` no longer has,
 * as renamed, when every file the snapshot records inside it was renamed
 * to the same place inside one new folder of `side`.
 */
function addDerivedFolders(snapshot: SyncSnapshot, side: Side, found: Map<VaultPath, RemoteRename>): void {
	for (const [from, synced] of snapshot) {
		if (synced.kind !== "folder" || found.has(from) || !side.gone(from)) continue;
		let folder: VaultPath | undefined;
		let consistent = true;
		for (const [path, entry] of snapshot) {
			if (entry.kind !== "file" || path === from || !isWithin(path, from)) continue;
			const rest = path.slice(from.length);
			const to = found.get(path)?.to;
			const candidate = to?.endsWith(rest) === true ? to.slice(0, to.length - rest.length) : undefined;
			if (candidate === undefined || (folder !== undefined && folder !== candidate)) consistent = false;
			folder = candidate;
		}
		if (consistent && folder !== undefined && isNewAt(side, "folder", folder, snapshot)) {
			found.set(from, { kind: "folder", from, to: folder });
		}
	}
}

/**
 * The snapshot's paths that the vault has under the same name in another
 * case only, on a case-insensitive provider, as renames to that case.
 */
function caseRenames(snapshot: SyncSnapshot, listing: SyncListing, { caseInsensitive }: RenameRules): Rename[] {
	if (!caseInsensitive) return [];
	const local = new Map(listing.local.map((entry) => [pathKey(entry.path, true), entry] as const));
	const found: Rename[] = [];
	for (const [from, synced] of snapshot) {
		const entry = local.get(pathKey(from, true));
		if (entry === undefined || entry.path === from || entry.kind !== synced.kind || snapshot.has(entry.path)) continue;
		found.push({ kind: synced.kind, from, to: entry.path });
	}
	return found;
}

/** `entries` by path. */
function byPath<T extends { readonly path: VaultPath }>(entries: readonly T[]): Map<VaultPath, T> {
	return new Map(entries.map((entry) => [entry.path, entry] as const));
}

/** Sorts the renames found on each side by what happened to the entry on the other. */
function classify(
	snapshot: SyncSnapshot,
	listing: SyncListing,
	here: ReadonlyMap<VaultPath, Rename>,
	there: ReadonlyMap<VaultPath, RemoteRename>,
	caseOnly: readonly Rename[],
	{ folderMove }: RenameRules,
): Renames {
	const toRemote: Rename[] = [];
	const toVault: RemoteRename[] = [];
	const sameOnBoth: RemoteRename[] = [];
	const differentOnBoth: RenamedOnBoth[] = [];
	const keptHere: Rename[] = [];
	const keptThere: Rename[] = [];
	for (const from of snapshot.keys()) {
		const local = here.get(from);
		const remote = there.get(from);
		if (local !== undefined && remote !== undefined) {
			if (local.to === remote.to) sameOnBoth.push(remote);
			else differentOnBoth.push({ kind: local.kind, from, vaultPath: local.to, remote });
		} else if (local !== undefined) {
			(listing.goneRemotely(from) ? keptHere : toRemote).push(local);
		} else if (remote !== undefined) {
			(listing.goneLocally(from) ? keptThere : toVault).push(remote);
		}
	}
	sameOnBoth.push(...caseOnly);
	const renames = {
		toRemote: folderMove ? movedWhole(snapshot, toRemote, (path) => listing.goneRemotely(path)) : filesOnly(toRemote),
		toVault: movedWhole(snapshot, toVault, (path) => listing.goneLocally(path)),
		sameOnBoth,
		// The vault takes the Remote's folder name in one rename, where that name is free.
		differentOnBoth: differentOnBoth.filter((rename) => rename.kind === "file" || listing.goneLocally(rename.remote.to)),
		keptHere,
		keptThere,
	};
	const all = [...renames.toRemote, ...renames.toVault, ...sameOnBoth, ...renames.differentOnBoth, ...keptHere, ...keptThere];
	return { ...renames, paths: new Set(all.map(({ from }) => from)) };
}

/**
 * The file renames among `renames`, carried to one side, and the folder
 * renames whose new path is `free` there and inside which every entry the
 * snapshot records is among `renames` at the same place inside the new
 * path, so one move carries them all.
 */
function movedWhole<T extends Rename>(snapshot: SyncSnapshot, renames: readonly T[], free: (path: VaultPath) => boolean): T[] {
	const targets = new Map(renames.map((rename) => [rename.from, rename.to] as const));
	return renames.filter(({ kind, from, to }) => {
		if (kind === "file") return true;
		if (!free(to)) return false;
		for (const path of snapshot.keys()) {
			if (path !== from && isWithin(path, from) && targets.get(path) !== movedAlong(path, from, to)) return false;
		}
		return true;
	});
}

/** The file renames among `renames`. */
function filesOnly<T extends Rename>(renames: readonly T[]): T[] {
	return renames.filter((rename) => rename.kind === "file");
}

/** Whether `side` has an entry of `kind` at `path` that is new: not in `snapshot`. */
function isNewAt(side: Side, kind: "file" | "folder", path: VaultPath, snapshot: SyncSnapshot): boolean {
	return side.entries.get(path)?.kind === kind && !snapshot.has(path);
}
