import type { Clock } from "../../src/engine/ports";
import { sha256, sha256Hex } from "../support/sha256";
import type { HttpRequest, HttpResponse } from "../../src/providers/dropbox/http";
import { ManualClock } from "./manual-clock";

/**
 * An interception that serves the request but loses its response, as when
 * the connection drops after the service acted: the caller gets no response.
 */
export const LOSE_RESPONSE = Symbol("lose response");

/** How long an access token lasts, in seconds, as Dropbox's `expires_in` says. */
export const ACCESS_TOKEN_SECONDS = 14400;

/**
 * An in-memory Dropbox HTTP service behind a `requestUrl`-shaped function,
 * for the Dropbox provider's tests (spec, "Testing Decisions", seam 2). It
 * answers the routes the connect step uses, in the shapes of the Dropbox
 * API spec (`dropbox/dropbox-api-spec`) and the official SDKs:
 *
 * - `www.dropbox.com/oauth2/authorize`: played by `approve`, which checks
 *   the query and returns the code the page would show;
 * - `api.dropboxapi.com/oauth2/token`: form-encoded `authorization_code`
 *   (PKCE, checked against the S256 challenge) and `refresh_token` grants;
 *   access tokens last `expires_in` seconds on `clock`; a refused code or
 *   refresh token gives 400 `{"error": "invalid_grant"}`;
 * - RPC routes on `api.dropboxapi.com/2/`: a JSON body (none for routes
 *   without an argument), a bearer access token, 401 with an AuthError for
 *   a bad or expired token, 409 with `{error_summary, error}` route errors;
 * - `content.dropboxapi.com/2/files/upload`, the sequential upload
 *   session routes (`upload_session/start`, `append_v2`, `finish`, with
 *   offset checks) and `files/download`: the argument in the
 *   `Dropbox-API-Arg` header, which must be ASCII, as HTTP headers are; a
 *   download answers the file's bytes with its metadata in
 *   `Dropbox-API-Result`, or `206` with the bytes a `Range` asks for;
 * - `rev:<rev>` paths for `files/download` and `files/get_metadata`,
 *   over every revision each file has had;
 * - `files/move_v2` without `autorename`: moves an entry with everything
 *   inside it, keeping ids and, since Dropbox does not document it either
 *   way, revisions; a missing source is `from_lookup/not_found`, an
 *   occupied target `to/conflict`;
 * - `files/delete_v2`, honouring `parent_rev`. Dropbox does not document
 *   its answer to a `parent_rev` that is not the file's latest; the real
 *   service, checked on 2026-10-21, answers 409 with a WriteError conflict
 *   (`path_write/conflict/file/`), and so does this fake.
 *
 * Each account's App Folder is one tree of entries, keyed by lowercased
 * path, since Dropbox paths are case-insensitive.
 */
export class FakeDropbox {
	/** Entries per listing page of `list_folder`; tests lower it to force paging. */
	listPageSize = 1000;
	/** Every request received, oldest first. */
	readonly requests: HttpRequest[] = [];
	/** Every response given, oldest first; none for a request answered with no response at all. */
	readonly responses: HttpResponse[] = [];
	/**
	 * Answers to give instead of serving the next requests, oldest first: a
	 * response, an Error for no response at all (offline), `LOSE_RESPONSE`
	 * to serve the request and then give no response, or null to serve that
	 * request as usual.
	 */
	readonly interceptions: (HttpResponse | Error | null | typeof LOSE_RESPONSE)[] = [];
	/**
	 * WriteError tags the next commits answer with instead of writing,
	 * oldest first, such as `too_many_write_operations`: a refusal that
	 * comes only after a session's data arrived.
	 */
	readonly writeRefusals: string[] = [];
	/** Called with each request before it is served: lets a test change the account mid-transfer. */
	onRequest: (request: HttpRequest) => void = () => undefined;

	private readonly accounts = new Map<string, FakeDropboxAccount>();
	private readonly codes = new Map<string, { readonly account: FakeDropboxAccount; readonly challenge: string }>();
	/** Refresh tokens not revoked, with their account. */
	private readonly refreshTokens = new Map<string, FakeDropboxAccount>();
	/** Access tokens issued: their refresh token, expiry time, and whether a test expired them early. */
	private readonly accessTokens = new Map<
		string,
		{ readonly refreshToken: string; readonly expiresAt: number; expired: boolean }
	>();
	private lastIssued = 0;
	/** Upload sessions not finished yet, by session id. */
	private readonly sessions = new Map<string, FakeSession>();
	/** Cursors issued by `list_folder` and `list_folder/continue`. */
	private readonly cursors = new Map<string, FolderCursor>();

	/**
	 * @param appKey the app key the plugin must present as `client_id`
	 * @param clock the service's time, which access tokens expire by
	 */
	constructor(
		readonly appKey: string,
		private readonly clock: Clock = new ManualClock(),
	) {}

	/** Creates an account with an empty App Folder. */
	addAccount(accountId: string): FakeDropboxAccount {
		const account = new FakeDropboxAccount(accountId);
		this.accounts.set(accountId, account);
		return account;
	}

	/**
	 * Plays `account` approving the plugin on the authorize page at
	 * `authorizeUrl`; returns the code Dropbox shows. Fails on a page the
	 * real service would not serve this way.
	 */
	approve(authorizeUrl: string, account: FakeDropboxAccount): string {
		const url = new URL(authorizeUrl);
		const query = url.searchParams;
		if (`${url.origin}${url.pathname}` !== "https://www.dropbox.com/oauth2/authorize") {
			throw new Error(`not the authorize page: ${authorizeUrl}`);
		}
		if (query.get("client_id") !== this.appKey) throw new Error("wrong client_id");
		if (query.get("response_type") !== "code") throw new Error("response_type is not code");
		if (query.get("code_challenge_method") !== "S256") throw new Error("not S256");
		const challenge = query.get("code_challenge");
		if (!challenge) throw new Error("no code_challenge");
		const code = `code-${this.next()}`;
		this.codes.set(code, { account, challenge });
		return code;
	}

	/**
	 * Issues a refresh token for `account` directly, as an earlier login
	 * would have: for tests of what a device does once connected.
	 */
	issueRefreshToken(account: FakeDropboxAccount): string {
		const refreshToken = `refresh-${this.next()}`;
		this.refreshTokens.set(refreshToken, account);
		return refreshToken;
	}

	/** Makes every access token issued so far expire. */
	expireAccessTokens(): void {
		for (const token of this.accessTokens.values()) token.expired = true;
	}

	/**
	 * The largest body of any request or response so far, in bytes: what
	 * the per-request limit bounds.
	 */
	largestBody(): number {
		const requestSizes = this.requests.map(({ body }) =>
			body === undefined ? 0 : typeof body === "string" ? new TextEncoder().encode(body).byteLength : body.byteLength,
		);
		const responseSizes = this.responses.map((response) => response.arrayBuffer.byteLength);
		return Math.max(0, ...requestSizes, ...responseSizes);
	}

	/** The `requestUrl`-shaped entry point the provider is given. */
	readonly requestUrl = async (request: HttpRequest): Promise<HttpResponse> => {
		this.requests.push(request);
		this.onRequest(request);
		const interception = this.interceptions.shift();
		if (interception instanceof Error) throw interception;
		if (interception === LOSE_RESPONSE) {
			this.responses.push(await this.handle(request));
			throw new Error("connection lost after the request arrived");
		}
		const response = interception ?? (await this.handle(request));
		this.responses.push(response);
		return response;
	};

	/** Serves one request: the token endpoint, or a route with a bearer token. */
	private async handle(request: HttpRequest): Promise<HttpResponse> {
		if (request.method !== "POST") return status(405, "method not allowed");
		const url = new URL(request.url);
		if (request.url === "https://api.dropboxapi.com/oauth2/token") return await this.token(request);
		const prefix = `${url.origin}/2/`;
		if (!request.url.startsWith(prefix)) return status(404, "unknown host or path");
		const route = request.url.slice(prefix.length);
		const tokenOwner = this.bearer(request);
		if ("response" in tokenOwner) return tokenOwner.response;
		const { account, refreshToken } = tokenOwner;
		if (url.origin === "https://content.dropboxapi.com") {
			if (route === "files/upload") return this.upload(account, request);
			if (route === "files/upload_session/start") return this.startSession(request);
			if (route === "files/upload_session/append_v2") return this.appendSession(request);
			if (route === "files/upload_session/finish") return this.finishSession(account, request);
			if (route === "files/download") return this.download(account, request);
			return status(404, "unknown route");
		}
		if (url.origin !== "https://api.dropboxapi.com") return status(404, "unknown host");
		const refused = badContentType(route, request);
		if (refused) return refused;
		const arg = parseBody(request);
		if (arg === invalid) return status(400, "Error in call: could not decode input as JSON");
		switch (route) {
			case "users/get_current_account":
				return json(200, { account_id: account.accountId, name: { display_name: "Test User" } });
			case "auth/token/revoke":
				this.revoke(refreshToken);
				return json(200, null);
			case "files/list_folder":
				return this.listFolder(account, arg as { path: string; recursive?: boolean });
			case "files/list_folder/continue":
				return this.listFolderContinue(account, arg as { cursor: string });
			case "files/get_metadata":
				return this.getMetadata(account, arg as { path: string });
			case "files/create_folder_v2":
				return this.createFolder(account, arg as { path: string; autorename?: boolean });
			case "files/delete_v2":
				return this.delete(account, arg as { path: string; parent_rev?: string });
			case "files/move_v2":
				return this.move(account, arg as { from_path: string; to_path: string });
			default:
				return status(404, `unknown route ${route}`);
		}
	}

	/** The token endpoint: code exchange and refresh. */
	private async token(request: HttpRequest): Promise<HttpResponse> {
		if (request.contentType !== "application/x-www-form-urlencoded" || typeof request.body !== "string") {
			return status(400, "expected a form-encoded body");
		}
		const form = new URLSearchParams(request.body);
		if (form.get("client_id") !== this.appKey) return invalidGrant("invalid client_id");
		switch (form.get("grant_type")) {
			case "authorization_code": {
				const code = form.get("code") ?? "";
				const issued = this.codes.get(code);
				if (!issued || form.has("redirect_uri")) return invalidGrant("code doesn't exist or has expired");
				const verifier = form.get("code_verifier") ?? "";
				if ((await s256(verifier)) !== issued.challenge) return invalidGrant("invalid code verifier");
				this.codes.delete(code);
				const refreshToken = `refresh-${this.next()}`;
				this.refreshTokens.set(refreshToken, issued.account);
				return json(200, {
					access_token: this.issueAccessToken(refreshToken),
					token_type: "bearer",
					expires_in: ACCESS_TOKEN_SECONDS,
					refresh_token: refreshToken,
					account_id: issued.account.accountId,
				});
			}
			case "refresh_token": {
				const refreshToken = form.get("refresh_token") ?? "";
				if (!this.refreshTokens.has(refreshToken)) return invalidGrant("refresh token is malformed");
				return json(200, {
					access_token: this.issueAccessToken(refreshToken),
					token_type: "bearer",
					expires_in: ACCESS_TOKEN_SECONDS,
				});
			}
			default:
				return status(400, "unsupported grant_type");
		}
	}

	/** Checks the bearer access token, returning its owner or a 401. */
	private bearer(
		request: HttpRequest,
	): { readonly account: FakeDropboxAccount; readonly refreshToken: string } | { readonly response: HttpResponse } {
		const accessToken = /^Bearer (.+)$/.exec(request.headers?.Authorization ?? "")?.[1] ?? "";
		const issued = this.accessTokens.get(accessToken);
		const account = issued && this.refreshTokens.get(issued.refreshToken);
		if (!issued || !account) return { response: authError("invalid_access_token") };
		if (issued.expired || this.clock.now() >= issued.expiresAt) {
			return { response: authError("expired_access_token") };
		}
		return { account, refreshToken: issued.refreshToken };
	}

	/** Disables a refresh token and every access token issued from it. */
	private revoke(refreshToken: string): void {
		this.refreshTokens.delete(refreshToken);
		for (const [token, issued] of this.accessTokens) {
			if (issued.refreshToken === refreshToken) this.accessTokens.delete(token);
		}
	}

	/** `files/list_folder`: the first page of a folder's entries. */
	private listFolder(account: FakeDropboxAccount, arg: { path: string; recursive?: boolean }): HttpResponse {
		if (arg.path !== "" && account.get(arg.path)?.kind !== "folder") {
			return routeError("path/not_found/", { ".tag": "path", path: { ".tag": "not_found" } });
		}
		const recursive = arg.recursive ?? false;
		return this.listPage({
			account,
			path: arg.path,
			recursive,
			entries: account.children(arg.path, recursive),
			offset: 0,
			position: account.changePosition(),
		});
	}

	/**
	 * `files/list_folder/continue`: the next page of an unfinished listing,
	 * or the changes since the previous batch finished; `reset` for an
	 * unknown cursor.
	 */
	private listFolderContinue(account: FakeDropboxAccount, arg: { cursor: string }): HttpResponse {
		const saved = this.cursors.get(arg.cursor);
		if (!saved || saved.account !== account) return routeError("reset/", { ".tag": "reset" });
		if (saved.offset < saved.entries.length) return this.listPage(saved);
		const { entries, position } = account.changesSince(saved.path, saved.recursive, saved.position);
		return this.listPage({ ...saved, entries, offset: 0, position });
	}

	/** Serves one page of `state.entries` from `state.offset`, issuing the cursor after it. */
	private listPage(state: FolderCursor): HttpResponse {
		const end = state.offset + this.listPageSize;
		const cursor = `cursor-${this.next()}`;
		this.cursors.set(cursor, { ...state, offset: Math.min(end, state.entries.length) });
		return json(200, {
			entries: state.entries.slice(state.offset, end),
			cursor,
			has_more: end < state.entries.length,
		});
	}

	/** `files/get_metadata`: an entry's metadata, or `path/not_found`. */
	private getMetadata(account: FakeDropboxAccount, arg: { path: string }): HttpResponse {
		const entry = account.read(arg.path);
		if (!entry) return routeError("path/not_found/", { ".tag": "path", path: { ".tag": "not_found" } });
		return json(200, metadataOf(entry));
	}

	/**
	 * `files/create_folder_v2`: creates the folder, or answers a WriteError
	 * conflict when an entry or a file ancestor is in the way.
	 */
	private createFolder(account: FakeDropboxAccount, arg: { path: string; autorename?: boolean }): HttpResponse {
		const existing = account.get(arg.path);
		if (existing) return writeConflict(existing.kind);
		const parent = arg.path.slice(0, arg.path.lastIndexOf("/"));
		if (parent !== "" && account.get(parent)?.kind === "file") return writeConflict("file_ancestor");
		account.putFolder(arg.path);
		return json(200, { metadata: account.metadata(arg.path) });
	}

	/**
	 * `files/delete_v2`: removes the entry and everything inside it, or
	 * answers `path_lookup/not_found`. With `parent_rev`, only a file of
	 * that revision is removed (see the class comment for the answer
	 * otherwise).
	 */
	private delete(account: FakeDropboxAccount, arg: { path: string; parent_rev?: string }): HttpResponse {
		const existing = account.get(arg.path);
		if (!existing) {
			return routeError("path_lookup/not_found/", { ".tag": "path_lookup", path_lookup: { ".tag": "not_found" } });
		}
		if (arg.parent_rev !== undefined && (existing.kind !== "file" || existing.rev !== arg.parent_rev)) {
			return routeError("path_write/conflict/file/", {
				".tag": "path_write",
				path_write: { ".tag": "conflict", conflict: { ".tag": "file" } },
			});
		}
		const metadata = account.metadata(arg.path);
		account.remove(arg.path);
		return json(200, { metadata });
	}

	/** `files/move_v2`: moves the entry and everything inside it, or answers a RelocationError. */
	private move(account: FakeDropboxAccount, arg: { from_path: string; to_path: string }): HttpResponse {
		if (!account.get(arg.from_path)) {
			return routeError("from_lookup/not_found/", { ".tag": "from_lookup", from_lookup: { ".tag": "not_found" } });
		}
		const inTheWay = account.get(arg.to_path);
		if (inTheWay) {
			return routeError(`to/conflict/${inTheWay.kind}/`, {
				".tag": "to",
				to: { ".tag": "conflict", conflict: { ".tag": inTheWay.kind } },
			});
		}
		account.move(arg.from_path, arg.to_path);
		return json(200, { metadata: account.metadata(arg.to_path) });
	}

	/**
	 * `files/download`: the file's bytes, or `path/not_found` for a path
	 * holding no file. With `Range: bytes=start-end` it answers `206` with
	 * those bytes and `Content-Range`, as on both mobile platforms; a range
	 * past the end gets `416`, which Dropbox does not document.
	 */
	private download(account: FakeDropboxAccount, request: HttpRequest): HttpResponse {
		const header = request.headers?.["Dropbox-API-Arg"] ?? "";
		if (/[^\x20-\x7e]/.test(header)) return status(400, "Dropbox-API-Arg is not ASCII");
		if (request.body !== undefined) return status(400, "a download has no body");
		const { path } = JSON.parse(header) as { path: string };
		const entry = account.read(path);
		if (entry?.kind !== "file") {
			return routeError("path/not_found/", { ".tag": "path", path: { ".tag": "not_found" } });
		}
		const headers = {
			"content-type": "application/octet-stream",
			"dropbox-api-result": JSON.stringify(metadataOf(entry)).replace(
				/[\u007f-\uffff]/g,
				(character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
			),
		};
		const range = request.headers?.Range;
		if (range === undefined) return { status: 200, headers, text: "", arrayBuffer: entry.data.slice(0) };
		const bounds = /^bytes=(\d+)-(\d+)$/.exec(range);
		if (!bounds) return status(400, `unsupported Range: ${range}`);
		const start = Number(bounds[1]);
		const end = Math.min(Number(bounds[2]), entry.data.byteLength - 1);
		if (start > end) return status(416, "range not satisfiable");
		return {
			status: 206,
			headers: { ...headers, "content-range": `bytes ${start}-${end}/${entry.data.byteLength}` },
			text: "",
			arrayBuffer: entry.data.slice(start, end + 1),
		};
	}

	/**
	 * `files/upload` in one request, honouring the write `mode` and
	 * `strict_conflict`; the argument must arrive as ASCII-only JSON.
	 */
	private upload(account: FakeDropboxAccount, request: HttpRequest): HttpResponse {
		const content = contentArg<CommitInfo>(request);
		if ("response" in content) return content.response;
		const committed = this.commit(account, content.arg, content.body);
		if ("response" in committed) return committed.response;
		// UploadError.path is a struct (UploadWriteFailed), so its fields sit beside the tag.
		return routeError(`path/${tagPath(committed.writeError)}`, {
			".tag": "path",
			reason: committed.writeError,
			upload_session_id: "session",
		});
	}

	/** `files/upload_session/start`: a sequential session holding the first chunk. */
	private startSession(request: HttpRequest): HttpResponse {
		const content = contentArg<{ session_type?: string }>(request);
		if ("response" in content) return content.response;
		if (content.arg.session_type !== undefined && content.arg.session_type !== "sequential") {
			return status(400, "only sequential sessions are faked");
		}
		const sessionId = `session-${this.next()}`;
		this.sessions.set(sessionId, { data: [new Uint8Array(content.body)] });
		return json(200, { session_id: sessionId });
	}

	/**
	 * `files/upload_session/append_v2`: appends a chunk at the cursor's
	 * offset, which must be the session's length so far.
	 */
	private appendSession(request: HttpRequest): HttpResponse {
		const content = contentArg<{ cursor: SessionCursor }>(request);
		if ("response" in content) return content.response;
		const session = this.lookUpSession(content.arg.cursor);
		if ("error" in session) return routeError(`${session.error[".tag"]}/`, session.error);
		session.data.push(new Uint8Array(content.body));
		return json(200, null);
	}

	/**
	 * `files/upload_session/finish`: appends the last chunk at the cursor's
	 * offset and commits the session's bytes as `files/upload` would. A
	 * commit refused keeps the session with the chunk appended, as Dropbox
	 * says: "Please retry with empty data body and updated offset."
	 */
	private finishSession(account: FakeDropboxAccount, request: HttpRequest): HttpResponse {
		const content = contentArg<{ cursor: SessionCursor; commit: CommitInfo }>(request);
		if ("response" in content) return content.response;
		const session = this.lookUpSession(content.arg.cursor);
		if ("error" in session) {
			return routeError(`lookup_failed/${session.error[".tag"]}/`, { ".tag": "lookup_failed", lookup_failed: session.error });
		}
		session.data.push(new Uint8Array(content.body));
		const whole = new Uint8Array(sessionLength(session));
		let offset = 0;
		for (const chunk of session.data) {
			whole.set(chunk, offset);
			offset += chunk.byteLength;
		}
		const committed = this.commit(account, content.arg.commit, whole.buffer);
		if (!("response" in committed)) {
			// UploadSessionFinishError.path is a union (WriteError), so it nests under its tag.
			return routeError(`path/${tagPath(committed.writeError)}`, { ".tag": "path", path: committed.writeError });
		}
		this.sessions.delete(content.arg.cursor.session_id);
		return committed.response;
	}

	/**
	 * The session at `cursor`, or the UploadSessionLookupError Dropbox
	 * answers: `not_found`, or `incorrect_offset` with the offset it
	 * expects.
	 */
	private lookUpSession(cursor: SessionCursor): FakeSession | { readonly error: Tagged } {
		const session = this.sessions.get(cursor.session_id);
		if (!session) return { error: { ".tag": "not_found" } };
		const length = sessionLength(session);
		if (cursor.offset !== length) return { error: { ".tag": "incorrect_offset", correct_offset: length } };
		return session;
	}

	/**
	 * Writes `data` to the commit's path as `files/upload` does, honouring
	 * the write `mode` and `strict_conflict`: the new metadata, or the
	 * WriteError refusing it, the next of `writeRefusals` first.
	 */
	private commit(
		account: FakeDropboxAccount,
		commit: CommitInfo,
		data: ArrayBuffer,
	): { readonly response: HttpResponse } | { readonly writeError: Tagged } {
		const refusal = this.writeRefusals.shift();
		if (refusal !== undefined) return { writeError: { ".tag": refusal } };
		const mode = typeof commit.mode === "string" ? { ".tag": commit.mode } : (commit.mode ?? { ".tag": "add" });
		const existing = account.get(commit.path);
		if (existing?.kind === "folder") return { writeError: conflict("folder") };
		if (existing && !commit.strict_conflict && sameBytes(existing.data, data)) {
			// Identical content is no conflict unless strict_conflict is set.
			return { response: json(200, account.metadata(commit.path)) };
		}
		if (mode[".tag"] === "add" && existing) return { writeError: conflict("file") };
		if (mode[".tag"] === "update" && existing?.rev !== mode.update) return { writeError: conflict("file") };
		account.putFile(commit.path, data.slice(0), `rev${this.next()}`);
		return { response: json(200, account.metadata(commit.path)) };
	}

	/** Issues an access token for `refreshToken`, valid for `ACCESS_TOKEN_SECONDS`. */
	private issueAccessToken(refreshToken: string): string {
		const accessToken = `access-${this.next()}`;
		const expiresAt = this.clock.now() + ACCESS_TOKEN_SECONDS * 1000;
		this.accessTokens.set(accessToken, { refreshToken, expiresAt, expired: false });
		return accessToken;
	}

	/** A number never handed out before, for codes, tokens and revisions. */
	private next(): number {
		this.lastIssued += 1;
		return this.lastIssued;
	}
}

/** The `files/upload` argument, and a session's `commit`. */
interface CommitInfo {
	readonly path: string;
	readonly mode?: string | { readonly ".tag": string; readonly update?: string };
	readonly autorename?: boolean;
	readonly strict_conflict?: boolean;
}

/** Where an upload session request appends. */
interface SessionCursor {
	readonly session_id: string;
	readonly offset: number;
}

/** An upload session: the chunks received so far. */
interface FakeSession {
	readonly data: Uint8Array[];
}

/** What a `list_folder` cursor points at. */
interface FolderCursor {
	readonly account: FakeDropboxAccount;
	readonly path: string;
	readonly recursive: boolean;
	readonly entries: readonly Record<string, unknown>[];
	readonly offset: number;
	readonly position: number;
}

/** The bytes an upload session holds so far. */
function sessionLength(session: FakeSession): number {
	return session.data.reduce((total, chunk) => total + chunk.byteLength, 0);
}

/** A WriteError conflict with what is in the way. */
function conflict(kind: "file" | "folder"): Tagged {
	return { ".tag": "conflict", conflict: { ".tag": kind } };
}

/** The tags of a nested union value as an `error_summary` path, e.g. `conflict/file/`. */
function tagPath(value: Tagged): string {
	const nested = Object.values(value).find((field): field is Tagged => typeof field === "object" && field !== null && ".tag" in field);
	return `${value[".tag"]}/${nested ? tagPath(nested) : ""}`;
}

/** A Dropbox union value: its tag plus the tag's fields. */
interface Tagged {
	readonly ".tag": string;
	readonly [field: string]: unknown;
}

/**
 * The argument of a content-upload route, from its ASCII-only
 * `Dropbox-API-Arg` header, and its octet-stream body; or the 400 the
 * service answers to a request without them.
 */
function contentArg<Arg>(
	request: HttpRequest,
): { readonly arg: Arg; readonly body: ArrayBuffer } | { readonly response: HttpResponse } {
	const header = request.headers?.["Dropbox-API-Arg"] ?? "";
	// HTTP headers carry only ASCII; the real service mangles anything else.
	if (/[^\x20-\x7e]/.test(header)) return { response: status(400, "Dropbox-API-Arg is not ASCII") };
	if (request.contentType !== "application/octet-stream" || !(request.body instanceof ArrayBuffer)) {
		return { response: status(400, "expected an application/octet-stream body") };
	}
	return { arg: JSON.parse(header) as Arg, body: request.body };
}

/** A file revision of a fake App Folder. */
interface FakeDropboxFile {
	readonly kind: "file";
	readonly path: string;
	readonly id: string;
	readonly data: ArrayBuffer;
	readonly rev: string;
}

/** One entry of a fake App Folder. */
type FakeDropboxEntry = { readonly kind: "folder"; readonly path: string; readonly id: string } | FakeDropboxFile;

/** A Dropbox account with its App Folder. */
export class FakeDropboxAccount {
	private readonly entries = new Map<string, FakeDropboxEntry>();
	/** Every file revision ever stored, by `rev`, as Dropbox keeps file history. */
	private readonly revisions = new Map<string, FakeDropboxFile>();
	/** Paths in the order they changed; a cursor records a position in it. */
	private readonly changeLog: string[] = [];
	private lastId = 0;

	/** @param accountId what `get_current_account` reports */
	constructor(readonly accountId: string) {}

	/** Creates a folder at `path` ("/Name/..."), with any missing parents. */
	putFolder(path: string): void {
		this.putParents(path);
		if (!this.get(path)) {
			this.entries.set(path.toLowerCase(), { kind: "folder", path, id: this.nextId() });
			this.changeLog.push(path);
		}
	}

	/** Creates or replaces the file at `path`, with any missing parents. */
	putFile(path: string, data: ArrayBuffer, rev: string): void {
		this.putParents(path);
		const id = this.get(path)?.id ?? this.nextId();
		const stored = this.get(path)?.path ?? path;
		const file: FakeDropboxFile = { kind: "file", path: stored, id, data, rev };
		this.entries.set(path.toLowerCase(), file);
		this.revisions.set(rev, file);
		this.changeLog.push(stored);
	}

	/**
	 * The entry a ReadPath names: a path, compared without case, or
	 * `rev:<rev>` for that revision of a file, even one replaced since.
	 */
	read(readPath: string): FakeDropboxEntry | undefined {
		return readPath.startsWith("rev:") ? this.revisions.get(readPath.slice("rev:".length)) : this.get(readPath);
	}

	/** Removes the entry at `path` and everything inside it. */
	remove(path: string): void {
		const lower = path.toLowerCase();
		for (const [key, entry] of [...this.entries]) {
			if (key === lower || key.startsWith(`${lower}/`)) {
				this.entries.delete(key);
				this.changeLog.push(entry.path);
			}
		}
	}

	/**
	 * Moves the entry at `from` and everything inside it to `to`, with any
	 * missing parents, keeping ids and revisions, and logs every path it
	 * frees and fills.
	 */
	move(from: string, to: string): void {
		this.putParents(to);
		const lower = from.toLowerCase();
		const moving = [...this.entries].filter(([key]) => key === lower || key.startsWith(`${lower}/`));
		for (const [key, entry] of moving) {
			this.entries.delete(key);
			this.changeLog.push(entry.path);
		}
		for (const [, entry] of moving) {
			const path = to + entry.path.slice(from.length);
			this.entries.set(path.toLowerCase(), { ...entry, path });
			this.changeLog.push(path);
		}
	}

	/** The entry at `path`, compared without case. */
	get(path: string): FakeDropboxEntry | undefined {
		return this.entries.get(path.toLowerCase());
	}

	/** The bytes of the file at `path`, if there is one. */
	file(path: string): ArrayBuffer | undefined {
		const entry = this.get(path);
		return entry?.kind === "file" ? entry.data : undefined;
	}

	/** Metadata of the entries under `path`, direct children unless `recursive`. */
	children(path: string, recursive: boolean): Record<string, unknown>[] {
		const prefix = `${path.toLowerCase()}/`;
		return [...this.entries.keys()]
			.filter((key) => key.startsWith(prefix) && (recursive || !key.slice(prefix.length).includes("/")))
			.sort()
			.map((key) => this.metadata(key));
	}

	/** The current end of the change log. */
	changePosition(): number {
		return this.changeLog.length;
	}

	/**
	 * Metadata of the entries under `path` changed since `position` in the
	 * change log, once per entry in order of first change, and the position
	 * after them.
	 */
	changesSince(
		path: string,
		recursive: boolean,
		position: number,
	): { readonly entries: Record<string, unknown>[]; readonly position: number } {
		const prefix = `${path.toLowerCase()}/`;
		const lastLogged = new Map<string, string>();
		for (const logged of this.changeLog.slice(position)) {
			const key = logged.toLowerCase();
			if (key.startsWith(prefix) && (recursive || !key.slice(prefix.length).includes("/"))) {
				lastLogged.set(key, logged);
			}
		}
		const entries = [...lastLogged].map(([key, logged]) => {
			const entry = this.entries.get(key);
			return entry ? metadataOf(entry) : deletedMetadataOf(logged);
		});
		return { entries, position: this.changeLog.length };
	}

	/** The Dropbox metadata of the entry at `path`, tagged like `Metadata`. */
	metadata(path: string): Record<string, unknown> {
		const entry = this.get(path);
		if (!entry) throw new Error(`no entry at ${path}`);
		return metadataOf(entry);
	}

	/** Creates the folders above `path`, as a write to it would. */
	private putParents(path: string): void {
		const parent = path.slice(0, path.lastIndexOf("/"));
		if (parent !== "") this.putFolder(parent);
	}

	/** A Dropbox-style file id never handed out before in this account. */
	private nextId(): string {
		this.lastId += 1;
		return `id:${this.accountId}-${this.lastId}`;
	}
}

/** The Dropbox metadata of `entry`, tagged like `Metadata`. */
function metadataOf(entry: FakeDropboxEntry): Record<string, unknown> {
	const common = {
		name: entry.path.slice(entry.path.lastIndexOf("/") + 1),
		path_lower: entry.path.toLowerCase(),
		path_display: entry.path,
		id: entry.id,
	};
	return entry.kind === "folder"
		? { ".tag": "folder", ...common }
		: { ".tag": "file", ...common, rev: entry.rev, size: entry.data.byteLength, content_hash: contentHashOf(entry.data) };
}

/**
 * Dropbox's `content_hash` of `data` (developers/reference/content-hash):
 * the SHA-256 of the SHA-256 digests of its 4 MiB blocks, as hex.
 */
function contentHashOf(data: ArrayBuffer): string {
	const block = 4 * 1024 * 1024;
	const count = Math.ceil(data.byteLength / block);
	const digests = new Uint8Array(count * 32);
	for (let index = 0; index < count; index += 1) {
		digests.set(sha256(new Uint8Array(data.slice(index * block, (index + 1) * block))), index * 32);
	}
	return sha256Hex(digests);
}

/** The Dropbox `DeletedMetadata` of an entry deleted at `path`. */
function deletedMetadataOf(path: string): Record<string, unknown> {
	return {
		".tag": "deleted",
		name: path.slice(path.lastIndexOf("/") + 1),
		path_lower: path.toLowerCase(),
		path_display: path,
	};
}

/** Marks a request body that is not valid JSON. */
const invalid = Symbol("invalid");

/**
 * The Content-Type an RPC request arrives with. Without one, Obsidian's
 * `requestUrl` on Android was seen to send a POST as
 * `application/x-www-form-urlencoded`, which Dropbox refuses, so the fake
 * takes it the same way.
 */
function contentTypeOf(request: HttpRequest): string {
	return request.contentType ?? "application/x-www-form-urlencoded";
}

/**
 * Dropbox's answer to an RPC request whose Content-Type is not JSON, as it
 * was seen on Android; undefined for a JSON one.
 */
function badContentType(route: string, request: HttpRequest): HttpResponse | undefined {
	const contentType = contentTypeOf(request);
	if (contentType === "application/json") return undefined;
	return status(
		400,
		`Error in call to API function "${route}": Bad HTTP "Content-Type" header: "${contentType}".  Expecting one of "application/json", "application/json; charset=utf-8", "text/plain; charset=dropbox-cors-hack".`,
	);
}

/** The JSON argument of an RPC request, `null` for a route without one. */
function parseBody(request: HttpRequest): unknown {
	if (typeof request.body !== "string") return invalid;
	try {
		return JSON.parse(request.body) as unknown;
	} catch {
		return invalid;
	}
}

/** The S256 code challenge of a PKCE verifier: unpadded base64url SHA-256. */
async function s256(verifier: string): Promise<string> {
	const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
	return btoa(String.fromCharCode(...digest))
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
}

/** Whether `a` and `b` hold the same bytes. */
function sameBytes(a: ArrayBuffer, b: ArrayBuffer): boolean {
	const left = new Uint8Array(a);
	const right = new Uint8Array(b);
	return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

/** A response with a JSON body. */
export function json(code: number, body: unknown): HttpResponse {
	return response(code, JSON.stringify(body), "application/json");
}

/** A response with a plain-text body. */
export function status(code: number, body: string): HttpResponse {
	return response(code, body, "text/plain; charset=utf-8");
}

/** A `requestUrl`-shaped response carrying `text` as its body. */
function response(code: number, text: string, contentType: string): HttpResponse {
	const encoded = new TextEncoder().encode(text);
	return {
		status: code,
		headers: { "content-type": contentType },
		text,
		arrayBuffer: encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength),
	};
}

/** A 409 route error, as Dropbox sends it. */
export function routeError(summary: string, error: unknown): HttpResponse {
	return json(409, { error_summary: summary, error });
}

/** A 401 auth error. */
function authError(tag: string): HttpResponse {
	return json(401, { error_summary: `${tag}/`, error: { ".tag": tag } });
}

/** A 400 OAuth error from the token endpoint. */
function invalidGrant(description: string): HttpResponse {
	return json(400, { error: "invalid_grant", error_description: description });
}

/** The `create_folder_v2` error for something in the way. */
function writeConflict(kind: "file" | "folder" | "file_ancestor"): HttpResponse {
	return routeError(`path/conflict/${kind}/`, {
		".tag": "path",
		path: { ".tag": "conflict", conflict: { ".tag": kind } },
	});
}

