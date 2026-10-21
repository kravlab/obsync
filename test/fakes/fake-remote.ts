import type { Change, ChangeBatch, NameRules, RemoteEntry, RemoteFile, RemotePath } from "../../src/engine/provider";
import { nameOf, parentOf } from "../../src/engine/paths";
import { FakeProvider } from "./fake-provider";
import type { CrashPoints } from "./crash-points";

/** A file as the fake service stores it. */
export interface StoredFile {
	readonly kind: "file";
	readonly data: ArrayBuffer;
	readonly revision: string;
	/** The entry's stable id, when the service gives stable ids. */
	readonly id?: string;
}

/** A folder as the fake service stores it. */
export interface StoredFolder {
	readonly kind: "folder";
	/** The entry's stable id, when the service gives stable ids. */
	readonly id?: string;
}

/** One entry of the fake service. */
export type StoredEntry = StoredFile | StoredFolder;

/**
 * What the fake service supports for this Remote. Every device opened on
 * the Remote sees the same service.
 */
export interface FakeServiceOptions {
	/** Honour preconditions on write and delete; on by default. */
	readonly conditionalWrite?: boolean;
	/** Offer the change feed; off by default. */
	readonly changeFeed?: boolean;
	/** Offer server-side file move; off by default. */
	readonly fileMove?: boolean;
	/** Offer server-side folder move; off by default. */
	readonly folderMove?: boolean;
	/**
	 * List entries with a stable id, kept when a file is overwritten or
	 * moved, new for a new entry; off by default.
	 */
	readonly stableIds?: boolean;
	/** Names the service refuses or folds; by default it accepts any name. */
	readonly nameRules?: Partial<NameRules>;
	/** Largest file the service accepts, in bytes; unlimited by default. */
	readonly maxFileSize?: number;
}

/**
 * An in-memory Remote: the state of one folder at a fake service. Several
 * FakeProviders opened on it act as several devices syncing one Remote.
 * Every change is logged, so the change feed can replay what happened
 * after any cursor. On a case-insensitive service, paths that differ only
 * by case address one entry, which keeps the case it was created with.
 */
export class FakeRemote {
	readonly nameRules: NameRules;
	readonly maxFileSize: number;
	/** Entries by `key(path)`, each with the path it was created under. */
	private readonly entries = new Map<string, { readonly path: RemotePath; readonly entry: StoredEntry }>();
	/** Paths in the order they changed; a cursor is a position in it. */
	private readonly changeLog: RemotePath[] = [];
	private lastRevision = 0;
	private lastId = 0;

	/** @param service what the fake service supports */
	constructor(readonly service: FakeServiceOptions = {}) {
		this.nameRules = {
			forbiddenCharacters: [],
			reservedNames: [],
			caseInsensitive: false,
			...service.nameRules,
		};
		this.maxFileSize = service.maxFileSize ?? Number.MAX_SAFE_INTEGER;
	}

	/** Opens a provider on this Remote, as one device would, counting its operations among `crashPoints`. */
	openProvider(crashPoints?: CrashPoints): FakeProvider {
		return new FakeProvider(this, crashPoints);
	}

	/** Returns the entry at `path`, if any. */
	get(path: RemotePath): StoredEntry | undefined {
		return this.entries.get(this.key(path))?.entry;
	}

	/**
	 * Stores `entry` at `path`, replacing what was there under the path it
	 * already had, and logs it. A new entry goes under the path its folder
	 * is stored with, as a case-insensitive service files it. With stable
	 * ids, an entry without one keeps the id of the entry it replaces, or
	 * gets a new one. Returns the entry as stored.
	 */
	put(path: RemotePath, entry: StoredEntry): StoredEntry {
		const key = this.key(path);
		const existing = this.entries.get(key);
		const storedPath = existing?.path ?? this.storedPathOf(path);
		const stored = this.withId(entry, existing?.entry.id);
		this.entries.set(key, { path: storedPath, entry: stored });
		this.changeLog.push(storedPath);
		return stored;
	}

	/**
	 * Replaces the folder at `path` and everything inside it with `entry`,
	 * logging only `path`: the one entry Dropbox's feed reports when a file
	 * replaces a folder, leaving the folder's children to be inferred.
	 */
	replaceFolder(path: RemotePath, entry: StoredEntry): void {
		const prefix = `${this.key(path)}/`;
		for (const key of [...this.entries.keys()]) {
			if (key.startsWith(prefix)) this.entries.delete(key);
		}
		this.put(path, entry);
	}

	/** Removes the entry at `path` and logs it. */
	remove(path: RemotePath): void {
		const key = this.key(path);
		const storedPath = this.entries.get(key)?.path ?? path;
		this.entries.delete(key);
		this.changeLog.push(storedPath);
	}

	/**
	 * Moves the entry at `from`, and everything inside it when it is a
	 * folder, to `to`, keeping each entry's revision and logging every
	 * path it frees and fills. The caller checks that `to` is free.
	 */
	move(from: RemotePath, to: RemotePath): void {
		for (const path of this.subtree(from)) {
			const stored = this.get(path);
			if (!stored) continue;
			this.remove(path);
			this.put(to + path.slice(from.length), stored);
		}
	}

	/** Every entry, as listed. */
	list(): RemoteEntry[] {
		return [...this.entries.values()].map(({ path, entry }) => toRemoteEntry(path, entry));
	}

	/** Stored paths of `path` and every entry inside it, outermost first. */
	subtree(path: RemotePath): RemotePath[] {
		const key = this.key(path);
		const prefix = `${key}/`;
		return [...this.entries]
			.filter(([entryKey]) => entryKey === key || entryKey.startsWith(prefix))
			.map(([, { path: storedPath }]) => storedPath)
			.sort((a, b) => a.length - b.length);
	}

	/** The cursor naming the Remote's current state. */
	cursor(): string {
		return String(this.changeLog.length);
	}

	/**
	 * The current state of every entry changed after `cursor`, once per
	 * entry in order of first change, and the cursor after them; undefined
	 * for a cursor this Remote never issued. Logged paths that differ only
	 * by case on a case-insensitive service are one entry: a present entry
	 * is reported under the path the listing gives it, a deleted one under
	 * the path it was last logged with.
	 */
	changesSince(cursor: string): ChangeBatch | undefined {
		const position = /^\d+$/.test(cursor) ? Number(cursor) : Number.NaN;
		if (!(position <= this.changeLog.length)) return undefined;
		const lastLogged = new Map<string, RemotePath>();
		for (const path of this.changeLog.slice(position)) {
			lastLogged.set(this.key(path), path);
		}
		const changes = [...lastLogged].map(([key, path]): Change => {
			const stored = this.entries.get(key);
			return stored ? toRemoteEntry(stored.path, stored.entry) : { kind: "deleted", path };
		});
		return { changes, cursor: this.cursor() };
	}

	/** Returns a revision token never used before on this Remote. */
	nextRevision(): string {
		this.lastRevision += 1;
		return `rev-${this.lastRevision}`;
	}

	/** `entry` with an id, `previous` or a new one, when the service gives stable ids. */
	private withId(entry: StoredEntry, previous: string | undefined): StoredEntry {
		if (this.service.stableIds !== true || entry.id !== undefined) return entry;
		this.lastId += 1;
		return { ...entry, id: previous ?? `id-${this.lastId}` };
	}

	/** Whether `path` is the root or an existing folder. */
	isFolder(path: RemotePath): boolean {
		return path === "" || this.get(path)?.kind === "folder";
	}

	/**
	 * Whether the service can store `path`: no forbidden character, no
	 * reserved segment, and within the length limits.
	 */
	canStore(path: RemotePath): boolean {
		const rules = this.nameRules;
		if (rules.maxPathLength !== undefined && path.length > rules.maxPathLength) return false;
		const reserved = new Set(rules.reservedNames.map((name) => this.key(name)));
		return path.split("/").every(
			(segment) =>
				!rules.forbiddenCharacters.some((character) => segment.includes(character)) &&
				!reserved.has(this.key(segment)) &&
				(rules.maxSegmentLength === undefined || segment.length <= rules.maxSegmentLength),
		);
	}

	/** `path` with its folders as they are stored: their case on a case-insensitive service. */
	private storedPathOf(path: RemotePath): RemotePath {
		const parent = parentOf(path);
		const storedParent = parent === "" ? "" : (this.entries.get(this.key(parent))?.path ?? parent);
		return storedParent === "" ? path : `${storedParent}/${nameOf(path)}`;
	}

	/** The key a path is stored under: folded on a case-insensitive service. */
	private key(path: RemotePath): string {
		return this.nameRules.caseInsensitive ? path.toLowerCase() : path;
	}

	/** Whether any entry lies inside the folder at `path`. */
	hasChildren(path: RemotePath): boolean {
		return this.subtree(path).length > 1;
	}
}

/** The listing entry of a stored entry. */
export function toRemoteEntry(path: RemotePath, stored: StoredEntry): RemoteEntry {
	if (stored.kind === "file") return toRemoteFile(path, stored);
	return stored.id === undefined ? { kind: "folder", path } : { kind: "folder", path, stableId: stored.id };
}

/** The listing entry of a stored file. */
export function toRemoteFile(path: RemotePath, stored: StoredFile): RemoteFile {
	const file: RemoteFile = { kind: "file", path, revision: stored.revision, size: stored.data.byteLength };
	return stored.id === undefined ? file : { ...file, stableId: stored.id };
}
