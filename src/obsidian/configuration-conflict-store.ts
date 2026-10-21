import type { DataAdapter } from "obsidian";
import type { VaultPath } from "../engine/local-vault";
import type { ConfigurationConflictStore, KeptConfiguration } from "../engine/ports";

/** The vault adapter's file operations the store uses. */
export type KeptFilesAdapter = Pick<
	DataAdapter,
	"exists" | "mkdir" | "list" | "read" | "write" | "readBinary" | "writeBinary" | "remove"
>;

/** The end of a kept version's description file name, after its id. */
const DESCRIPTION_SUFFIX = ".json";

/** The format version of a description; one of another version is not listed. */
const DESCRIPTION_FORMAT_VERSION = 1;

/**
 * The configuration conflict store in the sync plugin's own folder (spec,
 * "Synced file scope"), which never syncs, written through the vault
 * adapter since the folder is in the configuration folder, outside
 * Obsidian's index. Each kept version is two files of its own, named by
 * its id: `<id>` holds its bytes, `<id>.json` describes it (path, time,
 * format version). There is no shared index, so no write ever rewrites
 * what another version needs: a cut-off or unreadable file loses at most
 * its own version. The bytes are written before the description and the
 * description goes first on removal, so a cut-off keep or removal leaves
 * at most a stray data file, never a listed version without bytes. A
 * description of another format version, or one that cannot be read, is
 * skipped and left as it is (spec, "Further Notes", state format).
 */
export class ObsidianConfigurationConflicts implements ConfigurationConflictStore {
	/**
	 * @param adapter the vault adapter
	 * @param folder the store's folder in the plugin's own folder, created on first keep
	 * @param newId returns a new unique id for each kept version, a plain file name
	 */
	constructor(
		private readonly adapter: KeptFilesAdapter,
		private readonly folder: VaultPath,
		private readonly newId: () => string,
	) {}

	/** Creates the folder where missing, writes the bytes, then the description that lists them. */
	async keep(path: VaultPath, data: ArrayBuffer, keptAt: number): Promise<KeptConfiguration> {
		if (!(await this.adapter.exists(this.folder))) await this.adapter.mkdir(this.folder);
		const version = { id: this.newId(), path, keptAt };
		await this.adapter.writeBinary(this.dataPath(version.id), data);
		const description = { formatVersion: DESCRIPTION_FORMAT_VERSION, path, keptAt };
		await this.adapter.write(this.descriptionPath(version.id), `${JSON.stringify(description, null, "\t")}\n`);
		return version;
	}

	/** Every readable version in the folder, newest first; none when the folder does not exist yet. */
	async list(): Promise<readonly KeptConfiguration[]> {
		if (!(await this.adapter.exists(this.folder))) return [];
		const { files } = await this.adapter.list(this.folder);
		const ids = files
			.filter((file) => file.endsWith(DESCRIPTION_SUFFIX))
			.map((file) => file.slice(this.folder.length + 1, -DESCRIPTION_SUFFIX.length));
		const versions = await Promise.all(ids.map((id) => this.version(id)));
		return versions.filter((version) => version !== null).sort((a, b) => b.keptAt - a.keptAt);
	}

	/** The bytes of `id`, or null unless its description is readable and its bytes are there. */
	async read(id: string): Promise<ArrayBuffer | null> {
		if ((await this.version(id)) === null) return null;
		return this.adapter.readBinary(this.dataPath(id));
	}

	/** Removes the description of `id`, then its bytes, each only where it exists. */
	async remove(id: string): Promise<void> {
		for (const path of [this.descriptionPath(id), this.dataPath(id)]) {
			if (await this.adapter.exists(path)) await this.adapter.remove(path);
		}
	}

	/** The kept version `id`, or null when its description is missing or unreadable, or its bytes are missing. */
	private async version(id: string): Promise<KeptConfiguration | null> {
		const descriptionPath = this.descriptionPath(id);
		if (!(await this.adapter.exists(descriptionPath)) || !(await this.adapter.exists(this.dataPath(id)))) return null;
		const described = parseDescription(await this.adapter.read(descriptionPath));
		return described === null ? null : { id, ...described };
	}

	/** Where the description of the kept version `id` is. */
	private descriptionPath(id: string): VaultPath {
		return `${this.folder}/${id}${DESCRIPTION_SUFFIX}`;
	}

	/** Where the bytes of the kept version `id` are. */
	private dataPath(id: string): VaultPath {
		return `${this.folder}/${id}`;
	}
}

/** The path and time in the description text `stored`; null when it is not JSON, of another format version, or malformed. */
function parseDescription(stored: string): Omit<KeptConfiguration, "id"> | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(stored);
	} catch {
		return null;
	}
	if (typeof parsed !== "object" || parsed === null) return null;
	const { formatVersion, path, keptAt } = parsed as Record<string, unknown>;
	if (formatVersion !== DESCRIPTION_FORMAT_VERSION || typeof path !== "string" || typeof keptAt !== "number") return null;
	return { path, keptAt };
}
