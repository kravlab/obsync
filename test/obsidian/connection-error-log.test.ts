import { afterEach, describe, expect, it, vi } from "vitest";
import { ObsidianConnectionErrorLog, type ConnectionErrorLogAdapter } from "../../src/obsidian/connection-error-log";

/** The vault adapter's text file operations over a map, as the plugin folder on disk. */
class MemoryAdapter implements ConnectionErrorLogAdapter {
	readonly files = new Map<string, string>();
	/** When set, every write fails with it, as a full or read-only disk. */
	writeError: Error | undefined;

	exists(path: string): Promise<boolean> {
		return Promise.resolve(this.files.has(path));
	}

	read(path: string): Promise<string> {
		const stored = this.files.get(path);
		return stored === undefined ? Promise.reject(new Error(`no file ${path}`)) : Promise.resolve(stored);
	}

	write(path: string, data: string): Promise<void> {
		if (this.writeError) return Promise.reject(this.writeError);
		this.files.set(path, data);
		return Promise.resolve();
	}
}

const LOG = ".vault-config/plugins/obsync/obsync.log";

// A console spy is taken off even when a test fails before its end.
afterEach(() => {
	vi.restoreAllMocks();
});

describe("the connection error log file", () => {
	it("is created with the first line in the plugin's folder", async () => {
		const adapter = new MemoryAdapter();

		await new ObsidianConnectionErrorLog(adapter, ".vault-config/plugins/obsync").append("2026-10-21 16:37 Connecting failed.");

		expect(adapter.files.get(LOG)).toBe("2026-10-21 16:37 Connecting failed.\n");
	});

	it("adds each line after the ones it holds", async () => {
		const adapter = new MemoryAdapter();
		adapter.files.set(LOG, "first\n");
		const log = new ObsidianConnectionErrorLog(adapter, ".vault-config/plugins/obsync");

		await log.append("second");
		await log.append("third");

		expect(adapter.files.get(LOG)).toBe("first\nsecond\nthird\n");
	});

	it("keeps every line of appends started together, in the order they were started", async () => {
		const adapter = new MemoryAdapter();
		const log = new ObsidianConnectionErrorLog(adapter, ".vault-config/plugins/obsync");

		await Promise.all([log.append("first"), log.append("second"), log.append("third")]);

		expect(adapter.files.get(LOG)).toBe("first\nsecond\nthird\n");
	});

	it("goes on appending after a write that failed, the queue of appends unbroken", async () => {
		const adapter = new MemoryAdapter();
		const log = new ObsidianConnectionErrorLog(adapter, ".vault-config/plugins/obsync");
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		adapter.writeError = new Error("disk full");
		await log.append("lost");
		adapter.writeError = undefined;

		await log.append("kept");

		expect(adapter.files.get(LOG)).toBe("kept\n");
	});

	it("keeps only the newest 100 lines", async () => {
		const adapter = new MemoryAdapter();
		adapter.files.set(LOG, `${Array.from({ length: 100 }, (_, index) => `old ${index}`).join("\n")}\n`);

		await new ObsidianConnectionErrorLog(adapter, ".vault-config/plugins/obsync").append("new");

		const lines = adapter.files.get(LOG)?.split("\n") ?? [];
		expect(lines).toHaveLength(101);
		expect(lines[0]).toBe("old 1");
		expect(lines[99]).toBe("new");
		expect(lines[100]).toBe("");
	});

	it("reports a file it cannot write in the console, without failing", async () => {
		const adapter = new MemoryAdapter();
		adapter.writeError = new Error("read-only file system");
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

		await expect(new ObsidianConnectionErrorLog(adapter, ".vault-config/plugins/obsync").append("lost")).resolves.toBeUndefined();

		expect(consoleError).toHaveBeenCalledWith("obsync: writing the connection error log failed", adapter.writeError);
	});
});
