import type { Clock } from "../../src/engine/ports";
import type { HttpRequest, HttpResponse } from "../../src/providers/dropbox/http";
import { ManualClock } from "./manual-clock";

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
 * - `content.dropboxapi.com/2/files/upload`: the argument in the
 *   `Dropbox-API-Arg` header, which must be ASCII, as HTTP headers are.
 *
 * Each account's App Folder is one tree of entries, keyed by lowercased
 * path, since Dropbox paths are case-insensitive.
 */
export class FakeDropbox {
	/** Entries per listing page of `list_folder`; tests lower it to force paging. */
	listPageSize = 1000;
	/** Every request received, oldest first. */
	readonly requests: HttpRequest[] = [];
	/**
	 * Answers to give instead of serving the next requests, oldest first: a
	 * response, an Error for no response at all (offline), or null to serve
	 * that request as usual.
	 */
	readonly interceptions: (HttpResponse | Error | null)[] = [];

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

	/** Makes every access token issued so far expire. */
	expireAccessTokens(): void {
		for (const token of this.accessTokens.values()) token.expired = true;
	}

	/** The `requestUrl`-shaped entry point the provider is given. */
	readonly requestUrl = (request: HttpRequest): Promise<HttpResponse> => {
		this.requests.push(request);
		const interception = this.interceptions.shift();
		if (interception instanceof Error) return Promise.reject(interception);
		return interception ? Promise.resolve(interception) : this.handle(request);
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
			return route === "files/upload" ? this.upload(account, request) : status(404, "unknown route");
		}
		if (url.origin !== "https://api.dropboxapi.com") return status(404, "unknown host");
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
		const entries = account.children(arg.path, arg.recursive ?? false);
		return this.listPage(entries, 0);
	}

	/** `files/list_folder/continue`: the page a cursor points at. */
	private listFolderContinue(account: FakeDropboxAccount, arg: { cursor: string }): HttpResponse {
		const [path, recursive, offset] = JSON.parse(arg.cursor) as [string, boolean, number];
		return this.listPage(account.children(path, recursive), offset, [path, recursive]);
	}

	/** One page of `entries` from `offset`, with a cursor for the rest. */
	private listPage(
		entries: readonly Record<string, unknown>[],
		offset: number,
		folder: readonly [string, boolean] = ["", false],
	): HttpResponse {
		const end = offset + this.listPageSize;
		return json(200, {
			entries: entries.slice(offset, end),
			cursor: JSON.stringify([...folder, Math.min(end, entries.length)]),
			has_more: end < entries.length,
		});
	}

	/** `files/get_metadata`: an entry's metadata, or `path/not_found`. */
	private getMetadata(account: FakeDropboxAccount, arg: { path: string }): HttpResponse {
		const entry = account.get(arg.path);
		if (!entry) return routeError("path/not_found/", { ".tag": "path", path: { ".tag": "not_found" } });
		return json(200, account.metadata(arg.path));
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
	 * `files/upload` in one request, honouring the write `mode` and
	 * `strict_conflict`; the argument must arrive as ASCII-only JSON.
	 */
	private upload(account: FakeDropboxAccount, request: HttpRequest): HttpResponse {
		const header = request.headers?.["Dropbox-API-Arg"] ?? "";
		// HTTP headers carry only ASCII; the real service mangles anything else.
		if (/[^\x20-\x7e]/.test(header)) return status(400, "Dropbox-API-Arg is not ASCII");
		if (request.contentType !== "application/octet-stream" || !(request.body instanceof ArrayBuffer)) {
			return status(400, "expected an application/octet-stream body");
		}
		const arg = JSON.parse(header) as {
			path: string;
			mode?: string | { ".tag": string; update?: string };
			autorename?: boolean;
			strict_conflict?: boolean;
		};
		const mode = typeof arg.mode === "string" ? { ".tag": arg.mode } : (arg.mode ?? { ".tag": "add" });
		const existing = account.get(arg.path);
		if (existing?.kind === "folder") return uploadConflict("folder");
		if (existing && !arg.strict_conflict && sameBytes(existing.data, request.body)) {
			// Identical content is no conflict unless strict_conflict is set.
			return json(200, account.metadata(arg.path));
		}
		if (mode[".tag"] === "add" && existing) return uploadConflict("file");
		if (mode[".tag"] === "update" && existing?.rev !== mode.update) return uploadConflict("file");
		account.putFile(arg.path, request.body.slice(0), `rev${this.next()}`);
		return json(200, account.metadata(arg.path));
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

/** One entry of a fake App Folder. */
type FakeDropboxEntry =
	| { readonly kind: "folder"; readonly path: string; readonly id: string }
	| { readonly kind: "file"; readonly path: string; readonly id: string; readonly data: ArrayBuffer; readonly rev: string };

/** A Dropbox account with its App Folder. */
export class FakeDropboxAccount {
	private readonly entries = new Map<string, FakeDropboxEntry>();
	private lastId = 0;

	/** @param accountId what `get_current_account` reports */
	constructor(readonly accountId: string) {}

	/** Creates a folder at `path` ("/Name/..."), with any missing parents. */
	putFolder(path: string): void {
		this.putParents(path);
		if (!this.get(path)) this.entries.set(path.toLowerCase(), { kind: "folder", path, id: this.nextId() });
	}

	/** Creates or replaces the file at `path`, with any missing parents. */
	putFile(path: string, data: ArrayBuffer, rev: string): void {
		this.putParents(path);
		const id = this.get(path)?.id ?? this.nextId();
		const stored = this.get(path)?.path ?? path;
		this.entries.set(path.toLowerCase(), { kind: "file", path: stored, id, data, rev });
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

	/** The Dropbox metadata of the entry at `path`, tagged like `Metadata`. */
	metadata(path: string): Record<string, unknown> {
		const entry = this.get(path);
		if (!entry) throw new Error(`no entry at ${path}`);
		const common = {
			name: entry.path.slice(entry.path.lastIndexOf("/") + 1),
			path_lower: entry.path.toLowerCase(),
			path_display: entry.path,
			id: entry.id,
		};
		return entry.kind === "folder"
			? { ".tag": "folder", ...common }
			: { ".tag": "file", ...common, rev: entry.rev, size: entry.data.byteLength };
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

/** Marks a request body that is not valid JSON. */
const invalid = Symbol("invalid");

/** The JSON argument of an RPC request; null for a route without one. */
function parseBody(request: HttpRequest): unknown {
	if (request.body === undefined) return null;
	if (request.contentType !== "application/json" || typeof request.body !== "string") return invalid;
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

/** A 409 route error. */
function routeError(summary: string, error: unknown): HttpResponse {
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

/** The `upload` error for something in the way. */
function uploadConflict(kind: "file" | "folder"): HttpResponse {
	return routeError(`path/conflict/${kind}/`, {
		".tag": "path",
		reason: { ".tag": "conflict", conflict: { ".tag": kind } },
		upload_session_id: "session",
	});
}
