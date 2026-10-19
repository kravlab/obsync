/**
 * Maps Dropbox HTTP failures to the Provider contract's error categories
 * (spec, "Provider contract", errors). The response shapes follow the
 * Dropbox API spec and the official SDKs: 400 is bad input, or
 * `{"error": "invalid_grant"}` from the token endpoint; 401 carries an
 * AuthError; 409 carries the route's error as `{error_summary, error}`;
 * 429 carries a RateLimitError or a `Retry-After` header; 5xx is the
 * service failing.
 */
import { ProviderError, type ProviderFailure } from "../../engine/provider";
import type { HttpResponse } from "./http";

/** A Dropbox union value: its tag plus the tag's fields. */
export interface Tagged {
	readonly ".tag": string;
	readonly [field: string]: unknown;
}

/** The failure for a response with a status that is not a route error. */
export function failureOf(response: HttpResponse): ProviderError {
	const detail = `HTTP ${response.status}: ${response.text.slice(0, 200)}`;
	if (response.status === 401) return new ProviderError({ category: "auth" }, detail);
	if (response.status === 429) {
		return new ProviderError({ category: "throttled", retryAfterMs: retryAfterMs(response) }, detail);
	}
	if (response.status >= 500) return new ProviderError({ category: "transient" }, detail);
	return new ProviderError({ category: "permanent" }, detail);
}

/** The error a 409 response carries, or undefined if it carries none. */
export function routeErrorOf(response: HttpResponse): Tagged | undefined {
	const body = parseJson(response.text) as { error?: Tagged } | undefined;
	return typeof body?.error?.[".tag"] === "string" ? body.error : undefined;
}

/** Whether a 401 response says the access token expired. */
export function isExpiredToken(response: HttpResponse): boolean {
	return response.status === 401 && routeErrorOf(response)?.[".tag"] === "expired_access_token";
}

/** Whether a token-endpoint response refuses the grant (`invalid_grant`). */
export function isInvalidGrant(response: HttpResponse): boolean {
	const body = parseJson(response.text) as { error?: unknown } | undefined;
	return response.status === 400 && body?.error === "invalid_grant";
}

/**
 * The category of a WriteError, the reason `upload` and `create_folder_v2`
 * give for not writing. A conflict is something in the way; anything the
 * contract has no category for is permanent.
 */
export function writeFailure(reason: Tagged | undefined): ProviderFailure {
	switch (reason?.[".tag"]) {
		case "conflict":
			return { category: "preconditionFailed" };
		case "insufficient_space":
		case "team_folder_insufficient_space":
		case "member_folder_insufficient_space":
			return { category: "quotaExceeded" };
		case "malformed_path":
		case "disallowed_name":
			return { category: "nameNotRepresentable" };
		case "too_many_write_operations":
			return { category: "throttled", retryAfterMs: 1000 };
		default:
			return { category: "permanent" };
	}
}

/**
 * How long a 429 asks to wait: the RateLimitError's `retry_after`, else
 * the `Retry-After` header, in seconds; one second, the spec's default,
 * when neither says.
 */
function retryAfterMs(response: HttpResponse): number {
	const body = parseJson(response.text) as { error?: { retry_after?: unknown } } | undefined;
	const header = Object.entries(response.headers).find(([name]) => name.toLowerCase() === "retry-after")?.[1];
	const seconds = typeof body?.error?.retry_after === "number" ? body.error.retry_after : Number(header);
	return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 1000;
}

/** Parses JSON, or returns undefined for text that is not JSON. */
export function parseJson(text: string): unknown {
	try {
		return JSON.parse(text) as unknown;
	} catch {
		return undefined;
	}
}
