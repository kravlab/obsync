/**
 * The Dropbox connect step (spec, "Dropbox provider"; ADR 0004): the
 * paste-the-code PKCE login with the plugin's own app key, the account id
 * from `users/get_current_account`, Remote roots as subfolders of the
 * App Folder, and revoke.
 *
 * Paths are App-Folder paths: "" is the App Folder itself, and a root is
 * "/<folder name>" as Dropbox displays it.
 */
import type { AccountAccess, ConnectStep, AuthorizationAttempt, RootCandidate, RootSetup } from "../../engine/connect-step";
import type { Clock } from "../../engine/ports";
import { ProviderError, type Precondition, type RemoteFile } from "../../engine/provider";
import { DropboxClient, exchangeCode, type RouteResult } from "./client";
import { writeFailure, type Tagged } from "./errors";
import type { HttpClient } from "./http";
import { createPkce } from "./pkce";

const AUTHORIZE_URL = "https://www.dropbox.com/oauth2/authorize";

/**
 * The scopes the app asks for and nothing else (spec, "Dropbox
 * provider"): listing, download, upload and account info.
 */
const DROPBOX_SCOPES: readonly string[] = [
	"files.metadata.read",
	"files.content.read",
	"files.content.write",
	"account_info.read",
];

/** What the Dropbox provider is built from. */
export interface DropboxOptions {
	/** The plugin's Dropbox app key; public, with no secret (PKCE). */
	readonly appKey: string;
	/** Obsidian's `requestUrl`, or a fake in tests. */
	readonly http: HttpClient;
	/** This device's time, which access tokens expire by. */
	readonly clock: Clock;
}

/** Builds the Dropbox connect step. */
export function createDropboxConnectStep({ appKey, http, clock }: DropboxOptions): ConnectStep {
	return {
		providerId: "dropbox",

		async startAuthorization(): Promise<AuthorizationAttempt> {
			const pkce = await createPkce();
			return {
				authorizeUrl: authorizeUrl(appKey, pkce.challenge),
				async complete(code) {
					const tokens = await exchangeCode(http, clock, appKey, code, pkce.verifier);
					const client = new DropboxClient(http, clock, appKey, tokens.refreshToken, tokens.accessToken);
					const { account_id: accountId } = (await currentAccount(client)) as { account_id?: unknown };
					if (typeof accountId !== "string") {
						throw new ProviderError({ category: "permanent" }, "account without an account_id");
					}
					return { secret: tokens.refreshToken, accountId };
				},
			};
		},

		access(secret: string): AccountAccess {
			return createAccess(new DropboxClient(http, clock, appKey, secret));
		},
	};
}

/**
 * The account the fresh login opens. Only the code exchange may fail with
 * `auth`, which means a refused code; a token that was just issued and is
 * refused here (e.g. `missing_scope`) is a broken app setup, `permanent`.
 */
async function currentAccount(client: DropboxClient): Promise<unknown> {
	try {
		return expectValue(await client.rpc("users/get_current_account"), "get_current_account");
	} catch (error) {
		if (error instanceof ProviderError && error.failure.category === "auth") {
			throw new ProviderError({ category: "permanent" }, `account lookup refused: ${error.message}`);
		}
		throw error;
	}
}

/**
 * The authorize page: a code shown to the user (`response_type=code`, no
 * `redirect_uri`), a refresh token (`token_access_type=offline`), the four
 * scopes, and the S256 PKCE challenge. Values are percent-encoded, so the
 * scope list is separated by `%20`.
 */
function authorizeUrl(appKey: string, challenge: string): string {
	const query = [
		["client_id", appKey],
		["response_type", "code"],
		["token_access_type", "offline"],
		["scope", DROPBOX_SCOPES.join(" ")],
		["code_challenge", challenge],
		["code_challenge_method", "S256"],
	]
		.map(([name, value]) => `${name}=${encodeURIComponent(value ?? "")}`)
		.join("&");
	return `${AUTHORIZE_URL}?${query}`;
}

/** The connect-step operations of one login. */
function createAccess(client: DropboxClient): AccountAccess {
	/** Whether anything exists at `path`. */
	async function exists(path: string): Promise<boolean> {
		const result = await client.rpc("files/get_metadata", { path });
		if (result.ok) return true;
		if (lookupTag(result.error) === "not_found") return false;
		throw routeFailure("get_metadata", result.error);
	}

	/** Every direct entry of the App Folder, following `has_more`. */
	async function listAppFolder(): Promise<readonly Metadata[]> {
		const entries: Metadata[] = [];
		let page = expectListing(await client.rpc("files/list_folder", { path: "", recursive: false }));
		entries.push(...page.entries);
		while (page.has_more) {
			page = expectListing(await client.rpc("files/list_folder/continue", { cursor: page.cursor }));
			entries.push(...page.entries);
		}
		return entries;
	}

	return {
		async listRoots(marker: string): Promise<readonly RootCandidate[]> {
			const folders = (await listAppFolder()).filter((entry) => entry[".tag"] === "folder");
			const roots: RootCandidate[] = [];
			for (const folder of folders) {
				roots.push({
					root: folder.path_display,
					name: folder.name,
					holdsMarker: await exists(`${folder.path_display}/${marker}`),
				});
			}
			return roots;
		},

		async createRoot(name: string): Promise<RootCandidate> {
			const result = await client.rpc("files/create_folder_v2", { path: `/${name}`, autorename: false });
			if (!result.ok) throw new ProviderError(writeFailure(writeErrorOf(result.error)), summary(result.error));
			const { metadata } = result.value as { metadata: Metadata };
			return { root: metadata.path_display, name: metadata.name, holdsMarker: false };
		},

		openRoot(root: string): RootSetup {
			return createRootSetup(client, root);
		},

		async revoke(): Promise<void> {
			expectValue(await client.rpc("auth/token/revoke"), "token/revoke");
		},
	};
}

/**
 * The setup operations confined to `root`. Uploads go in one request: they
 * carry only the Metadata folder's small files here; chunked transfers
 * belong to the Provider proper.
 */
function createRootSetup(client: DropboxClient, root: string): RootSetup {
	return {
		async createFolder(path) {
			const result = await client.rpc("files/create_folder_v2", { path: `${root}/${path}`, autorename: false });
			if (!result.ok) {
				const reason = writeErrorOf(result.error);
				// An existing folder is returned as it is (Provider contract).
				const inTheWay = reason?.[".tag"] === "conflict" ? (reason.conflict as Tagged | undefined) : undefined;
				if (inTheWay?.[".tag"] !== "folder") throw new ProviderError(writeFailure(reason), summary(result.error));
			}
			return { kind: "folder", path };
		},

		async write(path, data, precondition): Promise<RemoteFile> {
			const result = await client.upload(
				{ path: `${root}/${path}`, mode: writeMode(precondition), autorename: false, strict_conflict: true },
				data,
			);
			if (!result.ok) throw uploadFailure(result.error);
			const { rev, size } = result.value as { rev: string; size: number };
			return { kind: "file", path, revision: rev, size };
		},
	};
}

/**
 * The upload `mode` for a precondition: `add` for "absent", `update` with
 * the revision, `overwrite` without one. Uploads are sent with
 * `strict_conflict`, so identical content and a deleted file still
 * conflict, as the precondition demands.
 */
function writeMode(precondition: Precondition | undefined): unknown {
	switch (precondition?.kind) {
		case undefined:
			return "overwrite";
		case "absent":
			return "add";
		case "revision":
			return { ".tag": "update", update: precondition.revision };
	}
}

/** Dropbox file or folder metadata, as far as the connect step reads it. */
interface Metadata {
	readonly ".tag": string;
	readonly name: string;
	readonly path_display: string;
}

/** A `list_folder` page. */
interface ListPage {
	readonly entries: readonly Metadata[];
	readonly cursor: string;
	readonly has_more: boolean;
}

/** The value of a route that has no route error worth telling apart. */
function expectValue(result: RouteResult, route: string): unknown {
	if (!result.ok) throw routeFailure(route, result.error);
	return result.value;
}

/** A `list_folder` page, or the route's error thrown as a ProviderError. */
function expectListing(result: RouteResult): ListPage {
	return expectValue(result, "list_folder") as ListPage;
}

/** The tag of a LookupError under a `path` error, e.g. `not_found`. */
function lookupTag(error: Tagged): string | undefined {
	return error[".tag"] === "path" ? (error.path as Tagged | undefined)?.[".tag"] : undefined;
}

/** The WriteError under `create_folder_v2`'s `path` error. */
function writeErrorOf(error: Tagged): Tagged | undefined {
	return error[".tag"] === "path" ? (error.path as Tagged | undefined) : undefined;
}

/** The failure for an `upload` route error. */
function uploadFailure(error: Tagged): ProviderError {
	if (error[".tag"] === "path") {
		return new ProviderError(writeFailure(error.reason as Tagged | undefined), summary(error));
	}
	if (error[".tag"] === "payload_too_large") return new ProviderError({ category: "tooLarge" }, summary(error));
	return routeFailure("upload", error);
}

/** A route error the caller has no category for. */
function routeFailure(route: string, error: Tagged): ProviderError {
	return new ProviderError({ category: "permanent" }, `${route}: ${summary(error)}`);
}

/** The route error as diagnostic text. */
function summary(error: Tagged): string {
	return JSON.stringify(error);
}
