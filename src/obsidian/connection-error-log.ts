import type { DataAdapter } from "obsidian";
import type { VaultPath } from "../engine/local-vault";

/** The vault adapter's file operations the log uses. */
export type ConnectionErrorLogAdapter = Pick<DataAdapter, "exists" | "read" | "write">;

/** The log's file name in the plugin's own folder. */
const LOG_FILE = "obsync.log";

/** How many lines the file keeps, newest last, like the Activity log. */
const LOG_LIMIT = 100;

/**
 * The failures while connecting and revoking on disconnect, as a text file
 * in the plugin's own folder (spec of copying a connect error; spec of the
 * review fixes, item 3), which never syncs: one line each, so a failure on
 * a phone can be taken off it as a file. It is written through the vault
 * adapter, since the folder is in the configuration folder, outside
 * Obsidian's index. It is a record for the user only: a write that fails
 * is reported in the console and changes nothing else.
 */
export class ObsidianConnectionErrorLog {
	private readonly path: VaultPath;
	/** The last append called, which the next one waits for; it never rejects. */
	private pending: Promise<void> = Promise.resolve();

	/**
	 * @param adapter the vault adapter
	 * @param pluginDir the plugin's own folder (`manifest.dir`), which exists while the plugin runs
	 */
	constructor(
		private readonly adapter: ConnectionErrorLogAdapter,
		pluginDir: VaultPath,
	) {
		this.path = `${pluginDir}/${LOG_FILE}`;
	}

	/**
	 * Adds `line` after the lines kept, keeping the newest `LOG_LIMIT`;
	 * never rejects. Appends on this log run one after another, in the order
	 * they were called: each reads the file and writes it back, so two at
	 * once would lose a line. Another log on the same file, as a second
	 * plugin load during a reload makes, is not kept in step with this one.
	 */
	append(line: string): Promise<void> {
		this.pending = this.pending.then(() => this.write(line));
		return this.pending;
	}

	/** Reads the file, adds `line`, and writes it back; a failure is reported in the console. */
	private async write(line: string): Promise<void> {
		try {
			const kept = (await this.adapter.exists(this.path)) ? linesOf(await this.adapter.read(this.path)) : [];
			await this.adapter.write(this.path, `${[...kept, line].slice(-LOG_LIMIT).join("\n")}\n`);
		} catch (error) {
			console.error("obsync: writing the connection error log failed", error);
		}
	}
}

/** The lines of the file's `text`, without the empty one after its last line break. */
function linesOf(text: string): string[] {
	return text.split("\n").filter((line) => line !== "");
}
