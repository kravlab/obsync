// Eval helpers that reach Dropbox from Obsidian's page with the plugin's own
// login, through Obsidian's `requestUrl` (a global on desktop and mobile): for a
// scenario to check what reached the Remote and to delete the run's Remote
// folder. The login and the tokens it gives never leave the page: a helper
// answers statuses, sizes and hashes, never a token.
//
// On the desktop a body is passed to the CLI as an argument, which the
// process list shows: a body that needs no request takes the helpers that
// hold no app key (PLUGIN_SECRET_HELPER, SHA256_HELPER), not dropboxHelpers.
import { providerSecretId } from "../../../src/engine/ports";
import { DEFAULT_REQUEST_LIMIT } from "../../../src/engine/request-limit";
import { DROPBOX_PROVIDER_ID } from "../../../src/providers/dropbox/provider";

/** How often `askDropbox` asks: rarely, as each ask is a request. */
export const ASK_EVERY_MS = 10_000;
/** How long `askDropbox` waits after Dropbox answered 429 (too many requests). */
export const THROTTLED_WAIT_MS = 60_000;

/** The plugin's Dropbox app key, as the build takes it: needed in the page to refresh the plugin's login. */
export function dropboxAppKey(): string {
	const key = process.env.SEAMSYNC_DROPBOX_APP_KEY;
	if (!key) throw new Error("Set SEAMSYNC_DROPBOX_APP_KEY, in the environment or in .env");
	return key;
}

/** Eval helper `pluginSecret()`: the plugin's stored login (the refresh token), or null when it is not connected. */
export const PLUGIN_SECRET_HELPER = `
	const pluginSecret = () => app.secretStorage.getSecret(${JSON.stringify(providerSecretId(DROPBOX_PROVIDER_ID))}) || null;`;

/** Eval helper `sha256(bytes)`: the hex SHA-256 of an ArrayBuffer. */
export const SHA256_HELPER = `
	const sha256 = async (bytes) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");`;

/**
 * Eval helpers, to put at the start of a body, for the app key `appKey`:
 *
 * - `pluginSecret()` is the plugin's stored login (the refresh token), or
 *   null when it is not connected;
 * - `dropboxAccess(secret)` exchanges it for an access token, resolving
 *   with `{ status, token }`, or `{ status, error }` when Dropbox refuses
 *   (`invalid_grant` for a revoked login);
 * - `dropboxCall(token, route, args)` calls an RPC route
 *   (`files/delete_v2`), resolving with `{ status, json }`: the answer on
 *   200, the route's error (`{ error_summary, error }`) on 409, nothing
 *   otherwise;
 * - `dropboxDownload(token, path, size)` resolves with the file's `size`
 *   bytes, read in `Range` parts no larger than the plugin's default
 *   Per-request limit, as the plugin reads them: Obsidian on Android turns
 *   a whole response into one base64 Java string, and a 50 MB one ran its
 *   process out of memory. A part answered with another status than 206,
 *   or with another length, fails it;
 * - `sha256(bytes)` is the hex SHA-256 of an ArrayBuffer;
 * - `askDropbox(ask, timeoutMs, what)` calls `ask` every ASK_EVERY_MS
 *   until it resolves with `{ status, done: true, value }`, and resolves
 *   with that value; an ask that fails or resolves with null is asked
 *   again, and one answered 429 after THROTTLED_WAIT_MS more. Fails after
 *   `timeoutMs` naming `what`. (Its last two parameters stand in for those
 *   constants in the helpers' own tests.)
 */
export function dropboxHelpers(appKey: string): string {
	return `${PLUGIN_SECRET_HELPER}${SHA256_HELPER}
	const dropboxAccess = async (secret) => {
		const response = await requestUrl({
			url: "https://api.dropboxapi.com/oauth2/token",
			method: "POST",
			contentType: "application/x-www-form-urlencoded",
			body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: secret, client_id: ${JSON.stringify(appKey)} }).toString(),
			throw: false,
		});
		return response.status === 200 ? { status: 200, token: response.json.access_token } : { status: response.status, error: response.json?.error };
	};
	const dropboxCall = async (token, route, args) => {
		const response = await requestUrl({
			url: "https://api.dropboxapi.com/2/" + route,
			method: "POST",
			contentType: "application/json",
			headers: { Authorization: "Bearer " + token },
			body: JSON.stringify(args),
			throw: false,
		});
		return { status: response.status, json: response.status === 200 || response.status === 409 ? response.json : undefined };
	};
	const dropboxDownload = async (token, path, size) => {
		const bytes = new Uint8Array(size);
		for (let start = 0; start < size; start += ${DEFAULT_REQUEST_LIMIT.bytes}) {
			const end = Math.min(start + ${DEFAULT_REQUEST_LIMIT.bytes}, size) - 1;
			const response = await requestUrl({
				url: "https://content.dropboxapi.com/2/files/download",
				method: "POST",
				headers: { Authorization: "Bearer " + token, "Dropbox-API-Arg": JSON.stringify({ path }), Range: "bytes=" + start + "-" + end },
				throw: false,
			});
			if (response.status !== 206) throw new Error("downloading " + path + " from " + start + ": HTTP " + response.status);
			if (response.arrayBuffer.byteLength !== end - start + 1) throw new Error("downloading " + path + " from " + start + ": " + response.arrayBuffer.byteLength + " bytes");
			bytes.set(new Uint8Array(response.arrayBuffer), start);
		}
		return bytes.buffer;
	};
	const askDropbox = async (ask, timeoutMs, what, everyMs = ${ASK_EVERY_MS}, throttledMs = ${THROTTLED_WAIT_MS}) => {
		const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
		const end = Date.now() + timeoutMs;
		for (;;) {
			if (Date.now() >= end) throw new Error("timed out after " + timeoutMs + " ms waiting for " + what + " on Dropbox");
			await sleep(everyMs);
			const answer = await ask().catch(() => null);
			if (answer?.status === 429) await sleep(throttledMs);
			else if (answer?.done) return answer.value;
		}
	};`;
}
