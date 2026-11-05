import { describe, expect, it } from "vitest";
import type { HttpRequest } from "../../src/providers/dropbox/http";
import { createDropboxConnector } from "../../src/providers/dropbox/provider";
import { FakeDropbox, LOSE_RESPONSE, json, routeError, status } from "../fakes/fake-dropbox";
import { ManualClock } from "../fakes/manual-clock";
import { bytes, patterned } from "../support/bytes";
import { openDropboxRemote, testRequestLimit, type DropboxRemote } from "../support/dropbox-remote";
import { expectFailure } from "../support/provider-failure";
import { readText, readBytes } from "../support/provider-read";

/** The Per-request limit these tests open the Remote with, in bytes. */
const LIMIT = 1000;

/** The route a request went to, such as `files/upload_session/start`. */
function routeOf(request: HttpRequest): string {
	return request.url.slice(request.url.indexOf("/2/") + "/2/".length);
}

/** The `Dropbox-API-Arg` of a content request, parsed. */
function argOf(request: HttpRequest): unknown {
	return JSON.parse(request.headers?.["Dropbox-API-Arg"] ?? "null") as unknown;
}

/** The size of a request's body in bytes. */
function bodySize(request: HttpRequest): number {
	return request.body instanceof ArrayBuffer ? request.body.byteLength : 0;
}

/**
 * A Remote with the per-request limit `LIMIT` that has listed once, so it
 * holds an access token and the next request is the one a test is about.
 */
async function setUp(): Promise<DropboxRemote> {
	const remote = await openDropboxRemote({ requestLimitBytes: LIMIT });
	await remote.provider.list();
	return remote;
}

/** Whether `data` holds exactly `patterned(size)`. */
function isPatterned(data: ArrayBuffer, size: number): boolean {
	const view = new Uint8Array(data);
	return view.length === size && view.every((byte, index) => byte === index % 251);
}

describe("Dropbox transfers", () => {
	it("uploads a file above the limit as one sequential session, each chunk at its offset", async () => {
		const { dropbox, provider } = await openDropboxRemote({ requestLimitBytes: LIMIT });
		const sent = dropbox.requests.length;
		await provider.write("scan.pdf", patterned(2 * LIMIT + 500), { kind: "absent" });
		const session = dropbox.requests.slice(sent).filter((request) => request.url.includes("/files/upload"));
		expect(session.map((request) => [routeOf(request), bodySize(request)])).toEqual([
			["files/upload_session/start", LIMIT],
			["files/upload_session/append_v2", LIMIT],
			["files/upload_session/finish", 500],
		]);
		const started = dropbox.responses[dropbox.requests.indexOf(session[0])];
		const sessionId = (JSON.parse(started?.text ?? "{}") as { session_id?: string }).session_id;
		expect(session.map(argOf)).toEqual([
			{ close: false },
			{ cursor: { session_id: sessionId, offset: LIMIT } },
			{
				cursor: { session_id: sessionId, offset: 2 * LIMIT },
				commit: { path: "/My vault/scan.pdf", mode: "add", autorename: false, strict_conflict: true },
			},
		]);
	});

	it("reads a file above the limit in Range parts of the revision get_metadata named", async () => {
		const { dropbox, provider } = await openDropboxRemote({ requestLimitBytes: LIMIT });
		const { revision } = await provider.write("scan.pdf", patterned(2 * LIMIT + 500));
		const sent = dropbox.requests.length;
		await provider.read("scan.pdf");
		const downloads = dropbox.requests.slice(sent).filter((request) => routeOf(request) === "files/download");
		expect(downloads.map((request) => [argOf(request), request.headers?.Range])).toEqual([
			[{ path: `rev:${revision}` }, "bytes=0-999"],
			[{ path: `rev:${revision}` }, "bytes=1000-1999"],
			[{ path: `rev:${revision}` }, "bytes=2000-2499"],
		]);
	});

	it("reads every part from one revision though the file changes mid-read", async () => {
		const { dropbox, account, provider } = await openDropboxRemote({ requestLimitBytes: LIMIT });
		await provider.write("scan.pdf", patterned(2 * LIMIT));
		dropbox.onRequest = (request) => {
			if (request.headers?.Range === "bytes=1000-1999") account.putFile("/My vault/scan.pdf", bytes("theirs"), "rev900");
		};
		expect([...new Uint8Array(await readBytes(provider, "scan.pdf"))]).toEqual([...new Uint8Array(patterned(2 * LIMIT))]);
		dropbox.onRequest = () => undefined;
		expect(await readText(provider, "scan.pdf")).toBe("theirs");
	});
});

describe("Dropbox upload session retries", () => {
	it("retries a session request that got a server error or no response, pausing 1 s each time", async () => {
		const { dropbox, provider, waits } = await setUp();
		// start, then append_v2 fails twice before it goes through.
		dropbox.interceptions.push(null, status(503, "unavailable"), new Error("offline"));
		await provider.write("scan.pdf", patterned(2 * LIMIT + 500));
		expect(waits).toEqual([1000, 1000]);
		expect(isPatterned(await readBytes(provider, "scan.pdf"), 2 * LIMIT + 500)).toBe(true);
	});

	it("waits as long as a rate limit asks before retrying", async () => {
		const { dropbox, provider, waits } = await setUp();
		// start, append_v2, then finish is rate limited once.
		dropbox.interceptions.push(
			null,
			null,
			json(429, { error_summary: "too_many_requests/", error: { reason: { ".tag": "too_many_requests" }, retry_after: 7 } }),
		);
		await provider.write("scan.pdf", patterned(2 * LIMIT + 500));
		expect(waits).toEqual([7000]);
		expect(isPatterned(await readBytes(provider, "scan.pdf"), 2 * LIMIT + 500)).toBe(true);
	});

	it("gives up after 3 retries with the last failure", async () => {
		const { dropbox, provider, waits } = await setUp();
		dropbox.interceptions.push(null, ...Array.from({ length: 4 }, () => status(503, "unavailable")));
		await expectFailure(provider.write("scan.pdf", patterned(2 * LIMIT + 500)), "transient");
		expect(waits).toEqual([1000, 1000, 1000]);
	});

	it("continues from Dropbox's offset when an appended chunk arrived but its answer did not", async () => {
		const { dropbox, provider, waits } = await setUp();
		// start, then the first append_v2 is stored but its answer is lost.
		dropbox.interceptions.push(null, LOSE_RESPONSE);
		await provider.write("scan.pdf", patterned(3 * LIMIT + 500));
		const appends = dropbox.requests.filter((request) => routeOf(request) === "files/upload_session/append_v2");
		expect(appends.map((request) => (argOf(request) as { cursor: { offset: number } }).cursor.offset)).toEqual([
			LIMIT,
			LIMIT,
			2 * LIMIT,
		]);
		expect(waits).toEqual([1000]);
		expect(isPatterned(await readBytes(provider, "scan.pdf"), 3 * LIMIT + 500)).toBe(true);
	});

	it("gives up as transient after 3 resumes in a row that do not get a request through", async () => {
		const { dropbox, provider } = await setUp();
		const stuck = routeError("incorrect_offset/", { ".tag": "incorrect_offset", correct_offset: LIMIT });
		dropbox.interceptions.push(null, stuck, stuck, stuck, stuck);
		await expectFailure(provider.write("scan.pdf", patterned(3 * LIMIT)), "transient");
		const appends = dropbox.requests.filter((request) => routeOf(request) === "files/upload_session/append_v2");
		expect(appends).toHaveLength(4);
	});

	it("retries a finish whose commit was refused after its chunk arrived, ending with an empty body", async () => {
		const { dropbox, provider, waits } = await setUp();
		dropbox.writeRefusals.push("too_many_write_operations");
		await provider.write("scan.pdf", patterned(LIMIT + 500));
		const finishes = dropbox.requests.filter((request) => routeOf(request) === "files/upload_session/finish");
		expect(finishes.map((request) => [(argOf(request) as { cursor: { offset: number } }).cursor.offset, bodySize(request)])).toEqual([
			[LIMIT, 500],
			[LIMIT, 500],
			[LIMIT + 500, 0],
		]);
		expect(waits).toEqual([1000]);
		expect(isPatterned(await readBytes(provider, "scan.pdf"), LIMIT + 500)).toBe(true);
	});

	it("retries a finish refused with too_many_write_operations", async () => {
		const { dropbox, provider, waits } = await setUp();
		dropbox.interceptions.push(null, routeError("too_many_write_operations/", { ".tag": "too_many_write_operations" }));
		await provider.write("scan.pdf", patterned(LIMIT + 500));
		expect(waits).toEqual([1000]);
		expect(isPatterned(await readBytes(provider, "scan.pdf"), LIMIT + 500)).toBe(true);
	});
});

describe("Dropbox upload session errors", () => {
	it("maps an expired session to transient, without retrying it", async () => {
		const { dropbox, provider, waits } = await setUp();
		dropbox.interceptions.push(null, routeError("not_found/", { ".tag": "not_found" }));
		await expectFailure(provider.write("scan.pdf", patterned(2 * LIMIT + 500)), "transient");
		expect(waits).toEqual([]);
	});

	it("maps a request or file too large for a session to tooLarge", async () => {
		const { dropbox, provider } = await setUp();
		dropbox.interceptions.push(routeError("payload_too_large/", { ".tag": "payload_too_large" }));
		await expectFailure(provider.write("scan.pdf", patterned(2 * LIMIT)), "tooLarge");
		dropbox.interceptions.push(null, routeError("too_large/", { ".tag": "too_large" }));
		await expectFailure(provider.write("scan.pdf", patterned(3 * LIMIT)), "tooLarge");
		dropbox.interceptions.push(
			null,
			routeError("lookup_failed/too_large/", { ".tag": "lookup_failed", lookup_failed: { ".tag": "too_large" } }),
		);
		await expectFailure(provider.write("scan.pdf", patterned(2 * LIMIT)), "tooLarge");
	});

	it("maps a full Dropbox at finish to quotaExceeded", async () => {
		const { dropbox, provider } = await setUp();
		dropbox.interceptions.push(
			null,
			routeError("path/insufficient_space/", { ".tag": "path", path: { ".tag": "insufficient_space" } }),
		);
		await expectFailure(provider.write("scan.pdf", patterned(2 * LIMIT)), "quotaExceeded");
	});

	it("maps an append to a closed session to permanent", async () => {
		const { dropbox, provider } = await setUp();
		dropbox.interceptions.push(null, routeError("closed/", { ".tag": "closed" }));
		await expectFailure(provider.write("scan.pdf", patterned(3 * LIMIT)), "permanent");
	});
});

describe("Dropbox download parts", () => {
	it("fails as permanent when a part comes back with another length", async () => {
		const { dropbox, provider } = await setUp();
		await provider.write("scan.pdf", patterned(2 * LIMIT));
		const short = { status: 206, headers: {}, text: "", arrayBuffer: new ArrayBuffer(10) };
		// get_metadata, then the first part comes back short.
		dropbox.interceptions.push(null, short);
		await expectFailure(provider.read("scan.pdf"), "permanent");
	});

	it("fails as permanent when a Range request is answered with the whole file", async () => {
		const { dropbox, provider } = await setUp();
		await provider.write("scan.pdf", patterned(2 * LIMIT));
		dropbox.interceptions.push(null, { status: 200, headers: {}, text: "", arrayBuffer: patterned(2 * LIMIT) });
		await expectFailure(provider.read("scan.pdf"), "permanent");
	});

	it.each([
		["shorter", 10],
		["longer", 101],
	])("fails as permanent when a download in one request comes back %s than the file", async (_, length) => {
		const { dropbox, provider } = await setUp();
		await provider.write("photo.png", patterned(100));
		// get_metadata, then the download comes back with another length than the file's 100 bytes.
		dropbox.interceptions.push(null, { status: 200, headers: {}, text: "", arrayBuffer: new ArrayBuffer(length) });

		await expectFailure(provider.read("photo.png"), "permanent");
	});

	it("reads a file up to the limit in one request without Range, its length the file's size", async () => {
		const { dropbox, provider } = await setUp();
		const { revision } = await provider.write("photo.png", patterned(100));
		const sent = dropbox.requests.length;

		const { data } = await provider.read("photo.png");

		const downloads = dropbox.requests.slice(sent).filter((request) => routeOf(request) === "files/download");
		expect(downloads.map((request) => [argOf(request), request.headers?.Range])).toEqual([[{ path: `rev:${revision}` }, undefined]]);
		expect(isPatterned(data, 100)).toBe(true);
	});

	it("reads an empty file", async () => {
		const { provider } = await setUp();
		await provider.write("empty.md", patterned(0));

		expect((await provider.read("empty.md")).data.byteLength).toBe(0);
	});

	it("fails reading a folder as permanent", async () => {
		const { provider } = await setUp();
		await provider.createFolder("notes");
		await expectFailure(provider.read("notes"), "permanent");
	});
});

describe("Dropbox per-request limit setting", () => {
	it("keeps each Provider to the limit set when it was opened", async () => {
		const clock = new ManualClock();
		const dropbox = new FakeDropbox("test-app-key", clock);
		const account = dropbox.addAccount("dbid:account-1");
		account.putFolder("/My vault");
		let limit = LIMIT;
		const connector = createDropboxConnector({
			appKey: "test-app-key",
			http: dropbox.requestUrl,
			clock,
			transfers: { requestLimit: () => testRequestLimit(limit), wait: () => Promise.resolve() },
		});
		const connection = { accountId: account.accountId, remoteRoot: "/My vault", device: { id: "laptop-id", name: "Laptop" } };
		const before = await connector.open(connection, dropbox.issueRefreshToken(account));
		limit = 2 * LIMIT;
		const after = await connector.open(connection, dropbox.issueRefreshToken(account));
		const uploadRoutes = (from: number) =>
			dropbox.requests
				.slice(from)
				.map(routeOf)
				.filter((route) => route.startsWith("files/upload"));

		let sent = dropbox.requests.length;
		await after.write("a.pdf", patterned(LIMIT + 500));
		expect(uploadRoutes(sent)).toEqual(["files/upload"]);
		sent = dropbox.requests.length;
		await before.write("b.pdf", patterned(LIMIT + 500));
		expect(uploadRoutes(sent)).toEqual(["files/upload_session/start", "files/upload_session/finish"]);
	});
});
