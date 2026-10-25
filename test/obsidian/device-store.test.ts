import { describe, expect, it } from "vitest";
import { parseConnection, parseEntry, parseRemoteFeed } from "../../src/obsidian/device-store";

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

describe("parseRemoteFeed", () => {
	const hash = { algorithm: "dropbox-content-hash", value: "abc123" };
	const file = { kind: "file", path: "photo.png", revision: "r1", size: 3 } as const;

	it("reads a file entry with its server hash, so a later sync can compare by it", () => {
		expect(parseRemoteFeed({ cursor: "c1", entries: [{ ...file, serverHash: hash }] })).toEqual({
			cursor: "c1",
			entries: [{ ...file, serverHash: hash }],
		});
	});

	it("reads a file entry without a server hash as one", () => {
		expect(parseRemoteFeed({ cursor: "c1", entries: [file] })).toEqual({ cursor: "c1", entries: [file] });
	});

	it("reads a malformed server hash as none, keeping the entry", () => {
		expect(parseRemoteFeed({ cursor: "c1", entries: [{ ...file, serverHash: { algorithm: 1 } }] })).toEqual({
			cursor: "c1",
			entries: [file],
		});
	});
});
