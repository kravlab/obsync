import type { DataAdapter } from "obsidian";
import type { VaultPath } from "../engine/local-vault";

/** The vault adapter's file operations the log uses. */
export type ConnectErrorLogAdapter = Pick<DataAdapter, "exists" | "read" | "write">;

/** The log's file name in the plugin's own folder. */
const LOG_FILE = "obsync.log";

/** How many lines the file keeps, newest last, like the Activity log. */
const LOG_LIMIT = 100;

/**
 * The failures while connecting, as a text file in the plugin's own folder
 * (spec of copying a connect error), which never syncs: one line each, so
 * a failure on a phone can be taken off it as a file. It is written
 * through the vault adapter, since the folder is in the configuration
 * folder, outside Obsidian's index. It is a record for the user only: a
 * write that fails is reported in the console and changes nothing else.
 */
export class ObsidianConnectErrorLog {
	private readonly path: VaultPath;

	/**
	 * @param adapter the vault adapter
	 * @param pluginDir the plugin's own folder (`manifest.dir`), which exists while the plugin runs
	 */
	constructor(
		private readonly adapter: ConnectErrorLogAdapter,
		pluginDir: VaultPath,
	) {
		this.path = `${pluginDir}/${LOG_FILE}`;
	}

	/** Adds `line` after the lines kept, keeping the newest `LOG_LIMIT`; never rejects. */
	async append(line: string): Promise<void> {
		try {
			const kept = (await this.adapter.exists(this.path)) ? linesOf(await this.adapter.read(this.path)) : [];
			await this.adapter.write(this.path, `${[...kept, line].slice(-LOG_LIMIT).join("\n")}\n`);
		} catch (error) {
			console.error("obsync: writing the connect error log failed", error);
		}
	}
}

/** The lines of the file's `text`, without the empty one after its last line break. */
function linesOf(text: string): string[] {
	return text.split("\n").filter((line) => line !== "");
}
