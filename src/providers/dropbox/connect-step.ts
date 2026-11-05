/**
 * The Dropbox connect step (spec, "Dropbox provider"; ADR 0004): the
 * paste-the-code PKCE login with the plugin's own app key, the account id
 * from `users/get_current_account`, Remote roots as subfolders of the
 * App Folder, and revoke.
 *
 * Paths are App-Folder paths: "" is the App Folder itself, and a root is
 * "/<folder name>" as Dropbox displays it.
 */
import type { AccountAccess, ConnectStep, AuthorizationAttempt, RootCandidate } from "../../engine/connect-step";
import { ProviderError, type Provider } from "../../engine/provider";
import { DropboxClient, exchangeCode } from "./client";
import { writeFailure } from "./errors";
import type { DropboxOptions, DropboxTransfers } from "./options";
import { createPkce } from "./pkce";
import { DROPBOX_PROVIDER_ID, createDropboxProvider } from "./provider";
import { expectValue, listFolder, lookupTag, routeFailure, summary, writeErrorOf, type Metadata } from "./routes";

const AUTHORIZE_URL = "https://www.dropbox.com/oauth2/authorize";

/**
 * The scopes the app asks for and nothing else (spec, "Dropbox
 * provider"): listing, download, upload and account info.
 */
const DROPBOX_SCOPES: readonly string[] = ["files.metadata.read", "files.content.read", "files.content.write", "account_info.read"];

/** Builds the Dropbox connect step. */
export function createDropboxConnectStep({ appKey, http, clock, transfers }: DropboxOptions): ConnectStep {
	return {
		providerId: DROPBOX_PROVIDER_ID,

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
			return createAccess(new DropboxClient(http, clock, appKey, secret), transfers);
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
function createAccess(client: DropboxClient, transfers: DropboxTransfers): AccountAccess {
	/** Whether anything exists at `path`. */
	async function exists(path: string): Promise<boolean> {
		const result = await client.rpc("files/get_metadata", { path });
		if (result.ok) return true;
		if (lookupTag(result.error) === "not_found") return false;
		throw routeFailure("get_metadata", result.error);
	}

	return {
		async listRoots(marker: string): Promise<readonly RootCandidate[]> {
			const { entries } = await listFolder(client, "", false);
			const folders = entries.filter((entry) => entry[".tag"] === "folder");
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

		openRoot(root: string): Provider {
			return createDropboxProvider(client, root, transfers);
		},

		async revoke(): Promise<void> {
			expectValue(await client.rpc("auth/token/revoke"), "token/revoke");
		},
	};
}
