/**
 * The connect step of the Provider contract (spec, "Provider contract";
 * map ticket 14, point 10): how a device logs in to a provider, chooses the
 * Remote root there, and later revokes its login. It is provider-neutral;
 * the provider owns its login flow and token handling, the engine owns
 * storing the secret and the Connection, the account check and the
 * cleanup on disconnect.
 *
 * Every failure is thrown as a `ProviderError`. A code the service refuses
 * during login (reused, expired or unknown) is an `auth` failure, and
 * nothing else in completing a login is.
 */
import type { Provider } from "./provider";

/** What a completed login yields. */
export interface Authorization {
	/**
	 * The long-lived credential, e.g. an OAuth refresh token. The engine
	 * keeps it in the Secret store only.
	 */
	readonly secret: string;
	/** The account at the provider, recorded with the Connection. */
	readonly accountId: string;
}

/** One login in progress, from the authorize page to the pasted code. */
export interface AuthorizationAttempt {
	/** The page the user opens in the browser to approve the plugin. */
	readonly authorizeUrl: string;
	/**
	 * Exchanges the code the user pasted for an Authorization. A refused
	 * code, and only that, fails with `auth`; the login then starts over
	 * with a new attempt.
	 */
	complete(code: string): Promise<Authorization>;
}

/** A folder that can serve as a Remote root. */
export interface RootCandidate {
	/** The root in the provider's own terms; opaque to the engine. */
	readonly root: string;
	/** The folder's name, shown to the user. */
	readonly name: string;
	/** Whether the folder holds an entry with the marker name asked for. */
	readonly holdsMarker: boolean;
}

/**
 * The operations that set up a Remote: creating the Metadata folder and
 * writing its files. They behave as the same operations of a Provider.
 */
export type RootSetup = Pick<Provider, "createFolder" | "write">;

/** The provider seen through one login's secret. */
export interface AccountAccess {
	/**
	 * Lists the folders that can be a Remote root, marking those that hold
	 * an entry named `marker` (the engine passes the Metadata folder's name;
	 * the provider knows nothing of its purpose).
	 */
	listRoots(marker: string): Promise<readonly RootCandidate[]>;
	/**
	 * Creates a new, empty root folder named `name`. Fails with
	 * `preconditionFailed` when the name is taken.
	 */
	createRoot(name: string): Promise<RootCandidate>;
	/** Returns the setup operations confined to `root`. */
	openRoot(root: string): RootSetup;
	/**
	 * Revokes the secret at the service, so it no longer works anywhere.
	 * Other devices' logins are unaffected.
	 */
	revoke(): Promise<void>;
}

/** One provider's connect step. */
export interface ConnectStep {
	/**
	 * Names the provider, lowercase alphanumeric with dashes; the engine
	 * stores the secret under an id built from it.
	 */
	readonly providerId: string;
	/** Starts a login. */
	startAuthorization(): Promise<AuthorizationAttempt>;
	/** Opens the provider with a stored secret. */
	access(secret: string): AccountAccess;
}
