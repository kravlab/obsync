/**
 * Connecting and disconnecting this device (spec, "Dropbox provider" and
 * "Provider contract", connect step; map ticket 14). The provider owns its
 * login, tokens and revoke behind the connect step; this module owns what
 * is the same for every provider: keeping the secret in the Secret store,
 * the Connection in the Device store, the account check, setting up the
 * Remote's Metadata folder, and the local cleanup on disconnect.
 */
import type { AccountAccess, Authorization, ConnectStep } from "./connect-step";
import { providerSecretId, type DeviceIdentity, type DeviceStore, type SecretStore, type UiPort } from "./ports";
import { ProviderError, isFailure, isSyncable } from "./provider";
import {
	DEFAULT_REMOTE_SETTINGS,
	DEVICES_FOLDER,
	METADATA_FOLDER,
	SETTINGS_PATH,
	devicePath,
	encodeDeviceRecord,
	encodeSettings,
} from "./remote-metadata";
import { statusOf } from "./status";

/** Everything connecting and disconnecting is built from. */
export interface ConnectionPorts {
	readonly connectStep: ConnectStep;
	readonly deviceStore: DeviceStore;
	readonly secretStore: SecretStore;
	readonly ui: UiPort;
	/** Returns a new random Device ID. */
	readonly newDeviceId: () => string;
}

/** Connects and disconnects this device. */
export interface ConnectionService {
	/** Reads this device's Connection and shows "Connected" or "Not connected". */
	showStatus(): Promise<void>;
	/** Returns this device as registered on its Remote, or null if not connected. */
	currentDevice(): Promise<DeviceIdentity | null>;
	/** Starts a login; the user opens its page and pastes back the code. */
	startAuthorization(): Promise<PendingAuthorization>;
	/**
	 * Revokes this device's login at the service, then clears its secret
	 * and everything it keeps for the Connection. The local cleanup runs
	 * even when the revoke fails, e.g. offline; the outcome then says so,
	 * since the user has to revoke the app in the service's own settings.
	 * The vault, the Remote and other devices are left untouched.
	 */
	disconnect(): Promise<DisconnectOutcome>;
}

/**
 * How disconnecting ended; the local cleanup ran either way:
 * - `disconnected`: the login no longer works at the service, revoked now
 *   or refused already, or there was no secret to revoke;
 * - `revokeFailed`: the service could not be asked, so the login may still
 *   work there until the user revokes it.
 */
export type DisconnectOutcome = { readonly kind: "disconnected" } | { readonly kind: "revokeFailed" };

/** A login waiting for the code the user pastes. */
export interface PendingAuthorization {
	/** The page the user opens in the browser to approve the plugin. */
	readonly authorizeUrl: string;
	/**
	 * Exchanges the pasted code. Failures other than a refused code are
	 * thrown as the `ProviderError` the connect step raised.
	 */
	submitCode(code: string): Promise<AuthorizationOutcome>;
}

/**
 * What a submitted code led to:
 * - `authorized`: a device without a Connection logged in and now chooses
 *   its Remote;
 * - `codeRejected`: the service refused the code (reused, expired or
 *   mistyped); nothing was stored, and the login starts over;
 * - `otherAccount`: the device has a Connection to a different account, so
 *   the login is refused and nothing changes; switching accounts means
 *   disconnecting first;
 * - `reconnected`: the device has a Connection to the same account; the new
 *   secret replaces the old one and the Connection stays as it was.
 */
export type AuthorizationOutcome =
	| { readonly kind: "authorized"; readonly remotes: RemoteChooser }
	| { readonly kind: "codeRejected" }
	| { readonly kind: "otherAccount" }
	| { readonly kind: "reconnected" };

/** A folder offered as this device's Remote. */
export interface RemoteCandidate {
	/** The root in the provider's own terms. */
	readonly root: string;
	/** The folder's name, shown to the user. */
	readonly name: string;
	/** Whether it already holds a Remote (a Metadata folder). */
	readonly isRemote: boolean;
}

/** Choosing the Remote after a login; each choice completes the connect. */
export interface RemoteChooser {
	/** Lists the folders that can be this device's Remote. */
	list(): Promise<readonly RemoteCandidate[]>;
	/**
	 * Uses the folder at `root` as this device's Remote: joins the Remote it
	 * holds, or makes a plain folder a new Remote, then registers this
	 * device and stores the Connection.
	 */
	useFolder(root: string, deviceName: string): Promise<ConnectOutcome>;
	/**
	 * Creates a new Remote named `name`, with the Metadata folder holding
	 * the default shared settings and this device's record, then stores the
	 * Connection. `deviceName` is the name this device is shown by.
	 *
	 * A failure after the folder is created is thrown, leaving the folder in
	 * `list()`; choosing it with `useFolder` finishes the setup.
	 */
	createRemote(name: string, deviceName: string): Promise<CreateRemoteOutcome>;
}

/**
 * What choosing a folder led to:
 * - `connected`: the device is connected to the Remote in it;
 * - `unsupportedProvider`: the provider does not report conditional
 *   writes for it, so it cannot be synced (`isSyncable`); nothing was
 *   written there and nothing stored.
 */
export type ConnectOutcome = { readonly kind: "connected" } | { readonly kind: "unsupportedProvider" };

/**
 * What creating a Remote led to: a `ConnectOutcome` for the new folder, or
 * - `nameTaken`: a folder with that name already exists; nothing changed;
 * - `invalidName`: the name holds a `/`, so it would make a nested folder
 *   that `list()` never offers; nothing changed.
 *
 * After `unsupportedProvider` the new folder stays, empty, and is listed
 * as a plain folder.
 */
export type CreateRemoteOutcome = ConnectOutcome | { readonly kind: "nameTaken" } | { readonly kind: "invalidName" };

/** Builds the connection service over `ports`. */
export function createConnectionService(ports: ConnectionPorts): ConnectionService {
	const { connectStep, deviceStore, secretStore, ui } = ports;
	const secretId = providerSecretId(connectStep.providerId);

	/**
	 * Checks that `root` can be synced, sets up the Metadata folder there and
	 * registers this device, then stores the secret and, last, the
	 * Connection: a device interrupted before that point is simply still not
	 * connected.
	 */
	async function connect(
		access: AccountAccess,
		authorization: Authorization,
		root: string,
		deviceName: string,
	): Promise<ConnectOutcome> {
		const setup = access.openRoot(root);
		if (!isSyncable(setup)) return { kind: "unsupportedProvider" };
		const device: DeviceIdentity = { id: ports.newDeviceId(), name: deviceName };
		await setup.createFolder(METADATA_FOLDER);
		try {
			await setup.write(SETTINGS_PATH, encodeSettings(DEFAULT_REMOTE_SETTINGS), { kind: "absent" });
		} catch (error) {
			// The Remote already has its settings: they were there, or another
			// device set up the same folder at the same moment. Both keep them.
			if (!isFailure(error, "preconditionFailed")) throw error;
		}
		await setup.createFolder(DEVICES_FOLDER);
		await setup.write(devicePath(device), encodeDeviceRecord(device), { kind: "absent" });
		secretStore.setSecret(secretId, authorization.secret);
		await deviceStore.saveConnection({ accountId: authorization.accountId, remoteRoot: root, device });
		ui.showStatus({ state: "connected" });
		return { kind: "connected" };
	}

	/** The Remote choice offered after `authorization` logged in. */
	function remoteChooser(authorization: Authorization): RemoteChooser {
		const access = connectStep.access(authorization.secret);
		return {
			async list(): Promise<readonly RemoteCandidate[]> {
				const roots = await access.listRoots(METADATA_FOLDER);
				return roots.map(({ root, name, holdsMarker }) => ({ root, name, isRemote: holdsMarker }));
			},
			useFolder(root: string, deviceName: string): Promise<ConnectOutcome> {
				return connect(access, authorization, root, deviceName);
			},
			async createRemote(name: string, deviceName: string): Promise<CreateRemoteOutcome> {
				if (name.includes("/")) return { kind: "invalidName" };
				let root: string;
				try {
					({ root } = await access.createRoot(name));
				} catch (error) {
					if (isFailure(error, "preconditionFailed")) return { kind: "nameTaken" };
					throw error;
				}
				return connect(access, authorization, root, deviceName);
			},
		};
	}

	/** Applies the account check to a completed login. */
	async function outcomeOf(authorization: Authorization): Promise<AuthorizationOutcome> {
		const connection = await deviceStore.loadConnection();
		if (connection === null) return { kind: "authorized", remotes: remoteChooser(authorization) };
		if (connection.accountId !== authorization.accountId) return { kind: "otherAccount" };
		secretStore.setSecret(secretId, authorization.secret);
		ui.showStatus({ state: "connected" });
		return { kind: "reconnected" };
	}

	return {
		async showStatus(): Promise<void> {
			const connection = await deviceStore.loadConnection();
			ui.showStatus(statusOf(connection));
		},

		async currentDevice(): Promise<DeviceIdentity | null> {
			return (await deviceStore.loadConnection())?.device ?? null;
		},

		async startAuthorization(): Promise<PendingAuthorization> {
			const attempt = await connectStep.startAuthorization();
			return {
				authorizeUrl: attempt.authorizeUrl,
				async submitCode(code: string): Promise<AuthorizationOutcome> {
					let authorization: Authorization;
					try {
						authorization = await attempt.complete(code);
					} catch (error) {
						if (isFailure(error, "auth")) return { kind: "codeRejected" };
						throw error;
					}
					return outcomeOf(authorization);
				},
			};
		},

		async disconnect(): Promise<DisconnectOutcome> {
			const secret = secretStore.getSecret(secretId);
			let outcome: DisconnectOutcome = { kind: "disconnected" };
			if (secret !== null) {
				try {
					await connectStep.access(secret).revoke();
				} catch (error) {
					if (!(error instanceof ProviderError)) throw error;
					// A refused secret is already revoked; any other failure leaves
					// it possibly valid. The cleanup below runs either way.
					if (error.failure.category !== "auth") outcome = { kind: "revokeFailed" };
				}
			}
			secretStore.deleteSecret(secretId);
			await deviceStore.clear();
			ui.showStatus({ state: "notConnected" });
			return outcome;
		},
	};
}
