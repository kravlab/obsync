import { describe, expect, it } from "vitest";
import { parseConnection, parseEntry } from "../../src/obsidian/device-store";

/** A stored Connection record as `saveConnection` writes it, with `fields` added to the Connection. */
function storedConnection(fields: Record<string, unknown> = {}): unknown {
	return {
		formatVersion: 1,
		connection: { accountId: "account", remoteRoot: "/vault", device: { id: "laptop-id", name: "Laptop" }, ...fields },
	};
}

describe("parseConnection", () => {
	it("reads a stored pause for Reconnect needed", () => {
		expect(parseConnection(storedConnection({ reconnectNeeded: true }))?.reconnectNeeded).toBe(true);
	});

	it("reads a Connection stored without a pause as not paused", () => {
		expect(parseConnection(storedConnection())?.reconnectNeeded).toBe(false);
	});

	it("reads a pause that is not true as not paused", () => {
		expect(parseConnection(storedConnection({ reconnectNeeded: "yes" }))?.reconnectNeeded).toBe(false);
	});

	it("reads a record of another format version as no Connection", () => {
		expect(parseConnection({ ...(storedConnection() as object), formatVersion: 2 })).toBeNull();
	});
});

describe("parseEntry", () => {
	const file = { kind: "file", revision: "r1", hash: "h1", size: 3 };

	it("reads the mark of a file whose synced content holds Conflict blocks", () => {
		expect(parseEntry({ ...file, conflicted: true })).toEqual({ ...file, conflicted: true });
	});

	it("reads a file without the mark, or with a mark that is not true, as holding no Conflict blocks", () => {
		expect(parseEntry(file)).toEqual(file);
		expect(parseEntry({ ...file, conflicted: "yes" })).toEqual(file);
	});
});
