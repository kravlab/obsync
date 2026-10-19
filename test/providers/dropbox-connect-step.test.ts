import { describe, expect, it } from "vitest";
import { createDropboxConnectStep } from "../../src/providers/dropbox/connect-step";
import { ProviderError } from "../../src/engine/provider";
import { bytes, text } from "../support/bytes";
import { rejection } from "../support/assertions";
import { expectFailure } from "../support/provider-failure";
import { ACCESS_TOKEN_SECONDS, FakeDropbox, json, status, type FakeDropboxAccount } from "../fakes/fake-dropbox";
import { ManualClock } from "../fakes/manual-clock";
import { testTransfers } from "../support/dropbox-remote";

/** A Dropbox service with one account, and the connect step on it, sharing one clock. */
function setUp(): {
	dropbox: FakeDropbox;
	account: FakeDropboxAccount;
	clock: ManualClock;
	connectStep: ReturnType<typeof createDropboxConnectStep>;
} {
	const clock = new ManualClock();
	const dropbox = new FakeDropbox("test-app-key", clock);
	const account = dropbox.addAccount("dbid:account-1");
	const connectStep = createDropboxConnectStep({
		appKey: "test-app-key",
		http: dropbox.requestUrl,
		clock,
		transfers: testTransfers(),
	});
	return { dropbox, account, clock, connectStep };
}

/** The requests `dropbox` received for `route`, e.g. `files/list_folder`. */
function requestsTo(dropbox: FakeDropbox, route: string): number {
	return dropbox.requests.filter((request) => request.url.endsWith(`/${route}`)).length;
}

/** Logs in to `account` and returns the access for the new secret. */
async function access({ dropbox, account, connectStep }: ReturnType<typeof setUp>) {
	const attempt = await connectStep.startAuthorization();
	const { secret } = await attempt.complete(dropbox.approve(attempt.authorizeUrl, account));
	return connectStep.access(secret);
}

describe("Dropbox login", () => {
	it("opens the authorize page for a shown code, a refresh token, the four scopes and S256", async () => {
		const { connectStep } = setUp();
		const url = new URL((await connectStep.startAuthorization()).authorizeUrl);

		expect(`${url.origin}${url.pathname}`).toBe("https://www.dropbox.com/oauth2/authorize");
		expect(Object.fromEntries(url.searchParams)).toEqual({
			client_id: "test-app-key",
			response_type: "code",
			token_access_type: "offline",
			scope: "files.metadata.read files.content.read files.content.write account_info.read",
			code_challenge: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) as unknown,
			code_challenge_method: "S256",
		});
		expect(url.search).not.toContain("+");
	});

	it("uses a new PKCE challenge for every login", async () => {
		const { connectStep } = setUp();
		const first = new URL((await connectStep.startAuthorization()).authorizeUrl).searchParams.get("code_challenge");
		const second = new URL((await connectStep.startAuthorization()).authorizeUrl).searchParams.get("code_challenge");
		expect(first).not.toBe(second);
	});

	it("exchanges the code with the PKCE verifier and no redirect_uri", async () => {
		const setup = setUp();
		await access(setup);
		const exchange = setup.dropbox.requests.find((request) => request.url.endsWith("/oauth2/token"));
		const form = new URLSearchParams(typeof exchange?.body === "string" ? exchange.body : "");
		expect(form.get("grant_type")).toBe("authorization_code");
		expect(form.get("client_id")).toBe("test-app-key");
		expect(form.get("code_verifier")).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(form.has("redirect_uri")).toBe(false);
	});

	it("refuses a code approved for another login attempt with auth", async () => {
		const { dropbox, account, connectStep } = setUp();
		const first = await connectStep.startAuthorization();
		const second = await connectStep.startAuthorization();
		const code = dropbox.approve(first.authorizeUrl, account);
		await expectFailure(second.complete(code), "auth");
	});

	it("fails a refused account lookup after the code exchange as permanent, not as a refused code", async () => {
		const { dropbox, account, connectStep } = setUp();
		const attempt = await connectStep.startAuthorization();
		const code = dropbox.approve(attempt.authorizeUrl, account);
		dropbox.interceptions.push(
			null,
			json(401, {
				error_summary: "missing_scope/",
				error: { ".tag": "missing_scope", required_scope: "account_info.read" },
			}),
		);
		await expectFailure(attempt.complete(code), "permanent");
	});
});

describe("Dropbox setup requests", () => {
	it("escapes non-ASCII path characters in Dropbox-API-Arg and stores the exact name", async () => {
		const setup = setUp();
		const vault = await access(setup);
		const { root } = await vault.createRoot("Заметки");
		await vault.openRoot(root).write("café 日本.md", bytes("hello"));

		const upload = setup.dropbox.requests.find((request) => request.url.endsWith("/files/upload"));
		expect(upload?.headers?.["Dropbox-API-Arg"]).toContain("\\u0417\\u0430");
		expect(upload?.headers?.["Dropbox-API-Arg"]).toContain("caf\\u00e9 \\u65e5\\u672c.md");
		expect(text(setup.account.file("/Заметки/café 日本.md") ?? new ArrayBuffer(0))).toBe("hello");
	});

	it("writes in update mode only over the revision given", async () => {
		const setup = setUp();
		const setupOps = (await access(setup)).openRoot((await (await access(setup)).createRoot("Vault")).root);
		const first = await setupOps.write("a.md", bytes("one"));
		const second = await setupOps.write("a.md", bytes("two"), { kind: "revision", revision: first.revision });
		expect(second.revision).not.toBe(first.revision);
		await expectFailure(
			setupOps.write("a.md", bytes("three"), { kind: "revision", revision: first.revision }),
			"preconditionFailed",
		);
	});

	it("refuses an absent precondition over an identical file", async () => {
		const setup = setUp();
		const vault = await access(setup);
		const ops = vault.openRoot((await vault.createRoot("Vault")).root);
		await ops.write("a.md", bytes("same"));
		await expectFailure(ops.write("a.md", bytes("same"), { kind: "absent" }), "preconditionFailed");
	});

	it("lists every App Folder subfolder across several listing pages", async () => {
		const setup = setUp();
		for (const name of ["A", "B", "C"]) setup.account.putFolder(`/${name}`);
		setup.account.putFile("/loose.md", bytes("not a folder"), "rev1");
		setup.dropbox.listPageSize = 1;
		const roots = await (await access(setup)).listRoots(".obsync");
		expect(roots.map((root) => root.name)).toEqual(["A", "B", "C"]);
	});

	it("reports the root as Dropbox displays it, so its subpaths resolve", async () => {
		const setup = setUp();
		setup.account.putFolder("/My Vault");
		const vault = await access(setup);
		const [root] = await vault.listRoots(".obsync");
		await vault.openRoot(root?.root ?? "").createFolder(".obsync");
		expect(setup.account.get("/my vault/.obsync")?.kind).toBe("folder");
	});
});

describe("Dropbox access tokens", () => {
	it("refreshes an access token past its expires_in before using it, with no refused request", async () => {
		const setup = setUp();
		const vault = await access(setup);
		await vault.listRoots(".obsync");
		setup.clock.advance(ACCESS_TOKEN_SECONDS * 1000);

		await vault.listRoots(".obsync");

		expect(requestsTo(setup.dropbox, "files/list_folder")).toBe(2);
		expect(requestsTo(setup.dropbox, "oauth2/token")).toBe(3);
	});

	it("refreshes an access token a minute before its expiry", async () => {
		const setup = setUp();
		const vault = await access(setup);
		await vault.listRoots(".obsync");
		setup.clock.advance(ACCESS_TOKEN_SECONDS * 1000 - 60_000);

		await vault.listRoots(".obsync");

		expect(requestsTo(setup.dropbox, "oauth2/token")).toBe(3);
	});

	it("keeps the access token while it is far from expiry", async () => {
		const setup = setUp();
		const vault = await access(setup);
		await vault.listRoots(".obsync");
		setup.clock.advance(ACCESS_TOKEN_SECONDS * 500);

		await vault.listRoots(".obsync");

		expect(requestsTo(setup.dropbox, "oauth2/token")).toBe(2);
	});
});

describe("Dropbox failures", () => {
	it("maps a rate limit to throttled with the wait it asks for", async () => {
		const setup = setUp();
		const vault = await access(setup);
		setup.dropbox.interceptions.push(
			json(429, { error_summary: "too_many_requests/", error: { reason: { ".tag": "too_many_requests" }, retry_after: 7 } }),
		);
		const error = await rejection(vault.listRoots(".obsync"));
		expect(error).toBeInstanceOf(ProviderError);
		expect((error as ProviderError).failure).toEqual({ category: "throttled", retryAfterMs: 7000 });
	});

	it("takes the wait from Retry-After when the rate limit has no JSON body", async () => {
		const setup = setUp();
		const vault = await access(setup);
		setup.dropbox.interceptions.push({ ...status(429, "slow down"), headers: { "Retry-After": "3" } });
		const error = await rejection(vault.listRoots(".obsync"));
		expect((error as ProviderError).failure).toEqual({ category: "throttled", retryAfterMs: 3000 });
	});

	it("maps a server error to transient", async () => {
		const setup = setUp();
		const vault = await access(setup);
		setup.dropbox.interceptions.push(status(503, "unavailable"));
		await expectFailure(vault.listRoots(".obsync"), "transient");
	});

	it("maps no response at all to transient", async () => {
		const setup = setUp();
		const vault = await access(setup);
		setup.dropbox.interceptions.push(new Error("net::ERR_INTERNET_DISCONNECTED"));
		await expectFailure(vault.revoke(), "transient");
	});

	it("maps a full Dropbox to quotaExceeded", async () => {
		const setup = setUp();
		const vault = await access(setup);
		const ops = vault.openRoot((await vault.createRoot("Vault")).root);
		setup.dropbox.interceptions.push(
			json(409, {
				error_summary: "path/insufficient_space/",
				error: { ".tag": "path", reason: { ".tag": "insufficient_space" }, upload_session_id: "s" },
			}),
		);
		await expectFailure(ops.write("a.md", bytes("a")), "quotaExceeded");
	});
});
