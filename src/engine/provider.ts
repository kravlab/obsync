/**
 * The Provider contract: how the sync engine talks to one cloud storage
 * service (spec, "Provider contract"; ADR 0001). A Provider is bound to one
 * Remote: the engine gets one from its `ProviderConnector` (ports.ts) for a
 * Connection. Every operation is confined to the Remote root, and the
 * Metadata folder is read and written like any other entry.
 */

/** A path relative to the Remote root, after the Remote's name policy. */
export type RemotePath = string;

/** A hash computed by the service, tagged with its algorithm. */
export interface ServerHash {
	readonly algorithm: string;
	readonly value: string;
}

/** A file in a listing or change feed. */
export interface RemoteFile {
	readonly kind: "file";
	readonly path: RemotePath;
	/** Opaque token that changes whenever the file's content changes. */
	readonly revision: string;
	/** Size in bytes. */
	readonly size: number;
	/** Opaque id that survives renames; a rename hint only. */
	readonly stableId?: string;
	readonly serverHash?: ServerHash;
	/** Modification time in ms since the epoch; for display, never decisions. */
	readonly serverMtime?: number;
}

/**
 * A folder in a listing or change feed. Folders, empty ones included, are
 * mirror entries; folders have no revision or size.
 */
export interface RemoteFolder {
	readonly kind: "folder";
	readonly path: RemotePath;
	readonly stableId?: string;
}

/** A file's whole content as read, with the revision those bytes are. */
export interface RemoteContent {
	/** The file's whole content. */
	readonly data: ArrayBuffer;
	/** The revision of `data`, as the listing and `write` report revisions. */
	readonly revision: string;
}

/** One entry of the Remote mirror. */
export type RemoteEntry = RemoteFile | RemoteFolder;

/**
 * A condition a `write` or `delete` of a file must meet at the service,
 * checked atomically there (never emulated by reading first). Only allowed
 * when the provider reports `conditionalWrite`; folders have no revision.
 */
export type Precondition = { readonly kind: "revision"; readonly revision: string } | { readonly kind: "absent" };

/** The result of a full listing. */
export interface Listing {
	readonly entries: readonly RemoteEntry[];
	/** Where the change feed continues from; present only with `changeFeed`. */
	readonly cursor?: string;
}

/** The current state of one path reported by the change feed. */
export type Change = RemoteEntry | { readonly kind: "deleted"; readonly path: RemotePath };

/**
 * A batch from the change feed. Paths may repeat; the last one wins. Folder
 * renames and deletes arrive expanded to every affected path.
 */
export interface ChangeBatch {
	readonly changes: readonly Change[];
	readonly cursor: string;
}

/** The change feed Capability. */
export interface ChangeFeed {
	/**
	 * Returns what changed since `cursor`. Throws `cursorLost` when the
	 * service no longer knows the cursor; the engine then lists in full.
	 */
	changes(cursor: string): Promise<ChangeBatch>;
}

/** The file move Capability. */
export interface FileMove {
	/**
	 * Moves one file. Fails with `preconditionFailed`, replacing nothing,
	 * when `to` is occupied.
	 */
	moveFile(from: RemotePath, to: RemotePath): Promise<RemoteFile>;
}

/** The folder move Capability. */
export interface FolderMove {
	/**
	 * Moves a folder with everything inside it. Fails with
	 * `preconditionFailed`, replacing nothing, when `to` is occupied.
	 */
	moveFolder(from: RemotePath, to: RemotePath): Promise<void>;
}

/**
 * Optional abilities of a Provider for its Remote. A Capability reported
 * here is honoured, never silently ignored; one not reported is treated as
 * absent, whatever the service itself could do.
 */
export interface Capabilities {
	/** `write` and `delete` honour a `Precondition`. */
	readonly conditionalWrite: boolean;
	readonly changeFeed?: ChangeFeed;
	readonly fileMove?: FileMove;
	readonly folderMove?: FolderMove;
}

/**
 * Which names the service can store; the engine applies the name policy.
 * Lengths count JavaScript string length (UTF-16 code units), which is what
 * the engine compares.
 */
export interface NameRules {
	/** Characters a path segment must not contain. */
	readonly forbiddenCharacters: readonly string[];
	/** Characters a path segment must not end with, such as a trailing space. */
	readonly forbiddenAtEnd: readonly string[];
	/** Whole segment names the service refuses, compared without case on a case-insensitive service. */
	readonly reservedNames: readonly string[];
	/** Paths that differ only by case name the same entry. */
	readonly caseInsensitive: boolean;
	/** Longest allowed path segment, if limited. */
	readonly maxSegmentLength?: number;
	/** Longest allowed Remote path, if limited. */
	readonly maxPathLength?: number;
}

/**
 * One provider bound to one Remote. Files move as whole buffers; a
 * provider splits them into requests under its per-request limit itself.
 * Every failure is thrown as a `ProviderError`.
 */
export interface Provider {
	readonly capabilities: Capabilities;
	readonly nameRules: NameRules;
	/** Largest file the service accepts, in bytes. */
	readonly maxFileSize: number;
	/** Lists every entry of the Remote; the root itself is not an entry. */
	list(): Promise<Listing>;
	/**
	 * Reads a whole file, with the revision of the bytes returned, which may
	 * be newer than the one the last listing showed.
	 */
	read(path: RemotePath): Promise<RemoteContent>;
	/**
	 * Creates or replaces a whole file and returns its new entry. The engine
	 * creates the parent folder first; a provider may also create missing
	 * parents itself.
	 */
	write(path: RemotePath, data: ArrayBuffer, precondition?: Precondition): Promise<RemoteFile>;
	/**
	 * Deletes one file, or one folder. The engine deletes a folder only after
	 * a listing shows it empty, and never asks the provider to delete
	 * recursively.
	 */
	delete(path: RemotePath, precondition?: Precondition): Promise<void>;
	/**
	 * Creates a folder; its parent must exist. A folder that already exists
	 * is returned as it is, so an interrupted sync can repeat the step.
	 */
	createFolder(path: RemotePath): Promise<RemoteFolder>;
}

/** The failure categories every provider maps its errors to. */
export type ProviderErrorCategory =
	| "auth"
	| "throttled"
	| "transient"
	| "notFound"
	| "preconditionFailed"
	| "cursorLost"
	| "quotaExceeded"
	| "tooLarge"
	| "nameNotRepresentable"
	| "permanent";

/** A provider failure; only `throttled` says when to retry. */
export type ProviderFailure =
	| { readonly category: "throttled"; readonly retryAfterMs: number }
	| { readonly category: Exclude<ProviderErrorCategory, "throttled"> };

/**
 * The one error type a Provider throws. The engine decides whether and when
 * to retry from `failure.category` alone.
 */
export class ProviderError extends Error {
	override readonly name = "ProviderError";

	/**
	 * @param failure the category, with `retryAfterMs` for `throttled`
	 * @param message what failed, as diagnostic detail for bug reports;
	 *   user-facing text comes from the shell's string table
	 */
	constructor(
		readonly failure: ProviderFailure,
		message: string,
	) {
		super(message);
	}
}

/**
 * Whether the engine syncs through `provider`: only with the
 * conditional-write Capability, since providers without it need Device
 * journals (ADR 0003), which this release does not build. Connecting
 * refuses such a provider, and a sync stops before touching anything.
 */
export function isSyncable(provider: Provider): boolean {
	return provider.capabilities.conditionalWrite;
}

/** Whether `error` is a provider failure of `category`. */
export function isFailure(error: unknown, category: ProviderErrorCategory): boolean {
	return error instanceof ProviderError && error.failure.category === category;
}
