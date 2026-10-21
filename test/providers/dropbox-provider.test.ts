import { describe, expect, it } from "vitest";
import { createDropboxConnector } from "../../src/providers/dropbox/provider";
import { bytes } from "../support/bytes";
import { expectFailure } from "../support/provider-failure";
import { openDropboxRemote, testTransfers, type DropboxRemote } from "../support/dropbox-remote";
import { FakeDropbox, json, routeError, status } from "../fakes/fake-dropbox";
import { ManualClock } from "../fakes/manual-clock";
import { readText } from "../support/provider-read";

/**
 * The Dropbox Provider on a fake account's Remote "/My vault", which has
 * listed the Remote once, so it holds an access token and the next request
 * is the one a test is about.
 */
async function setUp(): Promise<DropboxRemote> {
	const remote = await openDropboxRemote();
	await remote.provider.list();
	return remote;
}

describe("Dropbox provider", () => {
	it("names the Connection's provider as the connect step does", () => {
		const connector = createDropboxConnector({
			appKey: "k",
			http: new FakeDropbox("k").requestUrl,
			clock: new ManualClock(),
			transfers: testTransfers(),
		});
		expect(connector.providerId).toBe("dropbox");
	});

	it("reports conditional writes, the change feed, case-insensitive names and the upload-session size limit", async () => {
		const { provider } = await setUp();
		expect(provider.capabilities).toEqual({
			conditionalWrite: true,
			changeFeed: { changes: expect.any(Function) as unknown },
		});
		expect(provider.nameRules.caseInsensitive).toBe(true);
		// 2^41 - 2^22 bytes (Dropbox API spec, upload_session/append:2).
		expect(provider.maxFileSize).toBe(2_199_019_061_248);
	});

	it("pages through list_folder/continue in the change feed and leaves out entries outside the Remote", async () => {
		const { account, dropbox, provider } = await setUp();
		const { cursor } = await provider.list();
		account.putFolder("/Other vault");
		account.putFile("/Other vault/outside.md", bytes("out"), "rev90");
		await provider.createFolder("Notes");
		const first = await provider.write("Notes/a.md", bytes("a"));
		const second = await provider.write("Notes/b.md", bytes("b"));
		dropbox.listPageSize = 1;

		const batch = await provider.capabilities.changeFeed!.changes(cursor!);
		expect(batch.changes).toEqual([
			{ kind: "folder", path: "Notes" },
			{ kind: "file", path: "Notes/a.md", revision: first.revision, size: 1 },
			{ kind: "file", path: "Notes/b.md", revision: second.revision, size: 1 },
		]);
	});

	it("reports the change feed's entries in Dropbox's order, deletions included, for the engine to apply in turn", async () => {
		const { dropbox, provider } = await setUp();
		const meta = (tag: string, name: string, extra: Record<string, unknown> = {}) => ({
			".tag": tag,
			name: name.slice(name.lastIndexOf("/") + 1),
			path_lower: `/my vault/${name.toLowerCase()}`,
			path_display: `/My vault/${name}`,
			...extra,
		});
		dropbox.interceptions.push(
			json(200, {
				entries: [
					meta("deleted", "a"),
					meta("folder", "a"),
					meta("file", "a/new.md", { rev: "015a0000000001", size: 3 }),
				],
				cursor: "next",
				has_more: false,
			}),
		);

		const batch = await provider.capabilities.changeFeed!.changes("previous");

		expect(batch.changes).toEqual([
			{ kind: "deleted", path: "a" },
			{ kind: "folder", path: "a" },
			{ kind: "file", path: "a/new.md", revision: "015a0000000001", size: 3 },
		]);
	});

	it("maps a cursor reset in the change feed to cursorLost", async () => {
		const { dropbox, provider } = await setUp();
		const { cursor } = await provider.list();
		dropbox.interceptions.push(routeError("reset/", { ".tag": "reset" }));
		await expectFailure(provider.capabilities.changeFeed!.changes(cursor!), "cursorLost");
	});

	it("takes each path segment's case from the entry's own name, not from path_display", async () => {
		const { account, provider } = await setUp();
		account.putFolder("/My vault/Notes");
		// Created through a differently cased parent, so Dropbox displays the parent wrongly.
		account.putFile("/my vault/notes/Today.md", bytes("today"), "rev100");
		const paths = (await provider.list()).entries.map((entry) => entry.path);
		expect(paths.sort()).toEqual(["Notes", "Notes/Today.md"]);
	});

	it("lists the whole Remote across several listing pages, without the root itself", async () => {
		const { dropbox, provider } = await setUp();
		await provider.createFolder("a");
		await provider.write("a/1.md", bytes("1"));
		await provider.write("2.md", bytes("2"));
		dropbox.listPageSize = 1;
		const paths = (await provider.list()).entries.map((entry) => entry.path);
		expect(paths.sort()).toEqual(["2.md", "a", "a/1.md"]);
	});

	it("never lists entries outside its Remote", async () => {
		const { account, provider } = await setUp();
		account.putFolder("/Other vault");
		account.putFile("/Other vault/secret.md", bytes("other"), "rev200");
		account.putFile("/My vault backup.md", bytes("near"), "rev201");
		expect((await provider.list()).entries).toEqual([]);
	});

	it("fails as permanent on a listed file without its revision or size", async () => {
		const { dropbox, provider } = await setUp();
		const file = { ".tag": "file", name: "a.md", path_lower: "/my vault/a.md", path_display: "/My vault/a.md" };
		dropbox.interceptions.push(json(200, { entries: [file], cursor: "c1", has_more: false }));
		await expectFailure(provider.list(), "permanent");
		dropbox.interceptions.push(json(200, { entries: [{ ...file, rev: "015a" }], cursor: "c2", has_more: false }));
		await expectFailure(provider.list(), "permanent");
	});

	it("uploads with the argument in an ASCII-only Dropbox-API-Arg header", async () => {
		const { dropbox, provider } = await setUp();
		await provider.write("ноты.md", bytes("ноты"));
		expect(await readText(provider, "ноты.md")).toBe("ноты");
		const upload = dropbox.requests.find((request) => request.url.endsWith("/files/upload"));
		expect(upload?.headers?.["Dropbox-API-Arg"]).toMatch(/^\{"path":"\/My vault\/\\u043d\\u043e\\u0442\\u044b\.md",/);
	});

	it("deletes a file on condition of its revision with delete_v2 and parent_rev", async () => {
		const { dropbox, provider } = await setUp();
		const { revision } = await provider.write("note.md", bytes("one"));
		await provider.delete("note.md", { kind: "revision", revision });
		const request = dropbox.requests.find((sent) => sent.url.endsWith("/files/delete_v2"));
		expect(typeof request?.body === "string" && JSON.parse(request.body)).toEqual({
			path: "/My vault/note.md",
			parent_rev: revision,
		});
	});
});

describe("Dropbox provider errors", () => {
	it("maps a refused access token to auth", async () => {
		const { dropbox, provider } = await setUp();
		dropbox.interceptions.push(json(401, { error_summary: "invalid_access_token/", error: { ".tag": "invalid_access_token" } }));
		await expectFailure(provider.list(), "auth");
	});

	it("maps a rate limit to throttled with the wait it asks for", async () => {
		const { dropbox, provider } = await setUp();
		dropbox.interceptions.push(
			json(429, { error_summary: "too_many_requests/", error: { reason: { ".tag": "too_many_requests" }, retry_after: 7 } }),
		);
		const failure = await provider.read("note.md").catch((error: unknown) => error);
		expect(failure).toMatchObject({ failure: { category: "throttled", retryAfterMs: 7000 } });
	});

	it("maps a server error and no response at all to transient", async () => {
		const { dropbox, provider } = await setUp();
		dropbox.interceptions.push(status(503, "unavailable"));
		await expectFailure(provider.list(), "transient");
		dropbox.interceptions.push(new Error("offline"));
		await expectFailure(provider.read("note.md"), "transient");
	});

	it("maps a missing file to notFound on read and delete", async () => {
		const { provider } = await setUp();
		await expectFailure(provider.read("missing.md"), "notFound");
		await expectFailure(provider.delete("missing.md"), "notFound");
	});

	it("maps a delete over a newer revision to preconditionFailed", async () => {
		const { provider } = await setUp();
		const { revision } = await provider.write("note.md", bytes("one"));
		await provider.write("note.md", bytes("two"));
		await expectFailure(provider.delete("note.md", { kind: "revision", revision }), "preconditionFailed");
	});

	it("maps the real service's answer to a stale parent_rev to preconditionFailed", async () => {
		const { dropbox, provider } = await setUp();
		const { revision } = await provider.write("note.md", bytes("one"));
		// Recorded from delete_v2 with a superseded parent_rev on 2026-10-21.
		dropbox.interceptions.push(
			json(409, {
				error: { ".tag": "path_write", path_write: { ".tag": "conflict", conflict: { ".tag": "file" } } },
				error_summary: "path_write/conflict/file/",
			}),
		);
		await expectFailure(provider.delete("note.md", { kind: "revision", revision }), "preconditionFailed");
	});

	it("maps a cursor reset while paging the listing to cursorLost", async () => {
		const { dropbox, provider } = await setUp();
		await provider.write("1.md", bytes("1"));
		await provider.write("2.md", bytes("2"));
		dropbox.listPageSize = 1;
		dropbox.interceptions.push(null, routeError("reset/", { ".tag": "reset" }));
		await expectFailure(provider.list(), "cursorLost");
	});

	it("maps a full Dropbox to quotaExceeded", async () => {
		const { dropbox, provider } = await setUp();
		dropbox.interceptions.push(
			routeError("path/insufficient_space/", {
				".tag": "path",
				reason: { ".tag": "insufficient_space" },
				upload_session_id: "session",
			}),
		);
		await expectFailure(provider.write("note.md", bytes("one")), "quotaExceeded");
	});

	it("maps a body over the request limit to tooLarge", async () => {
		const { dropbox, provider } = await setUp();
		dropbox.interceptions.push(routeError("payload_too_large/", { ".tag": "payload_too_large" }));
		await expectFailure(provider.write("note.md", bytes("one")), "tooLarge");
	});

	it("maps a name Dropbox refuses to nameNotRepresentable", async () => {
		const { dropbox, provider } = await setUp();
		dropbox.interceptions.push(
			routeError("path/disallowed_name/", { ".tag": "path", reason: { ".tag": "disallowed_name" }, upload_session_id: "s" }),
		);
		await expectFailure(provider.write("desktop.ini", bytes("x")), "nameNotRepresentable");
	});

	it("maps a request Dropbox rejects as malformed to permanent", async () => {
		const { dropbox, provider } = await setUp();
		dropbox.interceptions.push(status(400, "Error in call to API function"));
		await expectFailure(provider.createFolder("notes"), "permanent");
	});
});
