/**
 * The Dropbox HTTP API as the provider uses it: RPC and upload calls with
 * a bearer access token, refreshed from the refresh token when missing or
 * near the end of its `expires_in`, and the token endpoint (spec, "Dropbox
 * provider"). Route errors
 * (409) are returned to the caller, which knows what each means; every
 * other failure is thrown as a ProviderError.
 */
import type { Clock } from "../../engine/ports";
import { ProviderError } from "../../engine/provider";
import { failureOf, isExpiredToken, isInvalidGrant, parseJson, routeErrorOf, type Tagged } from "./errors";
import type { HttpClient, HttpRequest, HttpResponse } from "./http";

const API_URL = "https://api.dropboxapi.com/2/";
const CONTENT_URL = "https://content.dropboxapi.com/2/";
const TOKEN_URL = "https://api.dropboxapi.com/oauth2/token";
/**
 * How long before its expiry an access token is replaced, in ms: room for
 * the request in flight and for this device's clock running behind.
 */
const EXPIRY_MARGIN_MS = 5 * 60 * 1000;

/** A route's result: its JSON value, or the error a 409 carried. */
export type RouteResult = { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly error: Tagged };

/** An access token and when it stops working, in ms since the epoch. */
export interface AccessToken {
	readonly token: string;
	readonly expiresAt: number;
}

/** The tokens a code exchange yields. */
export interface CodeTokens {
	readonly refreshToken: string;
	readonly accessToken: AccessToken;
}

/**
 * Exchanges a pasted authorization code with its PKCE verifier, with no
 * `redirect_uri`, as the login without one requires. A reused, expired or
 * unknown code (`invalid_grant`) fails with `auth`.
 */
export async function exchangeCode(
	http: HttpClient,
	clock: Clock,
	appKey: string,
	code: string,
	verifier: string,
): Promise<CodeTokens> {
	const body = await postToken(http, {
		grant_type: "authorization_code",
		code,
		client_id: appKey,
		code_verifier: verifier,
	});
	const { refresh_token: refreshToken } = body as { refresh_token?: unknown };
	if (typeof refreshToken !== "string") {
		throw new ProviderError({ category: "permanent" }, "token response without a refresh token");
	}
	return { refreshToken, accessToken: accessTokenOf(body, clock) };
}

/** One login's access to Dropbox, from its refresh token. */
export class DropboxClient {
	/**
	 * @param http sends the requests
	 * @param clock tells when the access token nears its expiry
	 * @param appKey the plugin's Dropbox app key
	 * @param refreshToken the login's long-lived token
	 * @param accessToken an access token already at hand, if any
	 */
	constructor(
		private readonly http: HttpClient,
		private readonly clock: Clock,
		private readonly appKey: string,
		private readonly refreshToken: string,
		private accessToken?: AccessToken,
	) {}

	/** Calls the RPC `route` with `arg`, or with no body for a route without one. */
	rpc(route: string, arg?: unknown): Promise<RouteResult> {
		return this.call((token) => ({
			url: API_URL + route,
			method: "POST",
			...(arg === undefined ? {} : { contentType: "application/json", body: JSON.stringify(arg) }),
			headers: { Authorization: `Bearer ${token}` },
			throw: false,
		}));
	}

	/**
	 * Uploads `data` in one request with the `files/upload` argument `arg`,
	 * sent in the `Dropbox-API-Arg` header.
	 */
	upload(arg: unknown, data: ArrayBuffer): Promise<RouteResult> {
		return this.call((token) => ({
			url: `${CONTENT_URL}files/upload`,
			method: "POST",
			contentType: "application/octet-stream",
			body: data,
			headers: { Authorization: `Bearer ${token}`, "Dropbox-API-Arg": headerSafeJson(arg) },
			throw: false,
		}));
	}

	/**
	 * Sends a request built around an access token. An expired token is
	 * refreshed once and the request retried; any other 401 is `auth`.
	 */
	private async call(build: (accessToken: string) => HttpRequest): Promise<RouteResult> {
		let response = await send(this.http, build(await this.token()));
		if (isExpiredToken(response)) {
			this.accessToken = undefined;
			response = await send(this.http, build(await this.token()));
		}
		if (response.status === 200) return { ok: true, value: successBody(response) };
		const error = response.status === 409 ? routeErrorOf(response) : undefined;
		if (error) return { ok: false, error };
		throw failureOf(response);
	}

	/**
	 * The access token, refreshed from the refresh token when there is none
	 * or it expires within `EXPIRY_MARGIN_MS`.
	 */
	private async token(): Promise<string> {
		if (this.accessToken === undefined || this.clock.now() >= this.accessToken.expiresAt - EXPIRY_MARGIN_MS) {
			const body = await postToken(this.http, {
				grant_type: "refresh_token",
				refresh_token: this.refreshToken,
				client_id: this.appKey,
			});
			this.accessToken = accessTokenOf(body, this.clock);
		}
		return this.accessToken.token;
	}
}

/**
 * Posts a form to the token endpoint and returns its JSON. A refused grant
 * (`invalid_grant`: a bad code, or a revoked refresh token) is `auth`.
 */
async function postToken(http: HttpClient, form: Record<string, string>): Promise<unknown> {
	const response = await send(http, {
		url: TOKEN_URL,
		method: "POST",
		contentType: "application/x-www-form-urlencoded",
		body: new URLSearchParams(form).toString(),
		throw: false,
	});
	if (response.status === 200) return successBody(response);
	if (isInvalidGrant(response)) throw new ProviderError({ category: "auth" }, `token refused: ${response.text}`);
	throw failureOf(response);
}

/**
 * The access token in a token-endpoint response, expiring `expires_in`
 * seconds from now.
 */
function accessTokenOf(body: unknown, clock: Clock): AccessToken {
	const { access_token: token, expires_in: expiresIn } = body as { access_token?: unknown; expires_in?: unknown };
	if (typeof token !== "string" || typeof expiresIn !== "number") {
		throw new ProviderError({ category: "permanent" }, "token response without an access token and its lifetime");
	}
	return { token, expiresAt: clock.now() + expiresIn * 1000 };
}

/** Sends `request`; no response at all (offline, DNS, TLS) is `transient`. */
async function send(http: HttpClient, request: HttpRequest): Promise<HttpResponse> {
	try {
		return await http(request);
	} catch (error) {
		throw new ProviderError({ category: "transient" }, `no response from ${request.url}: ${String(error)}`);
	}
}

/** The JSON body of a successful response; a body that is not JSON is `permanent`. */
function successBody(response: HttpResponse): unknown {
	const body = parseJson(response.text);
	if (body === undefined) {
		throw new ProviderError({ category: "permanent" }, `response is not JSON: ${response.text.slice(0, 200)}`);
	}
	return body;
}

/**
 * JSON for the `Dropbox-API-Arg` header: HTTP headers carry only ASCII, so
 * 0x7F and every non-ASCII UTF-16 unit is escaped as `\uXXXX`, the same
 * escaping as the official JavaScript SDK (`httpHeaderSafeJson`).
 */
function headerSafeJson(value: unknown): string {
	return JSON.stringify(value).replace(
		/[\u007f-￿]/g,
		(character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
	);
}
