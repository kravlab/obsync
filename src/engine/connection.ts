/**
 * Connecting and disconnecting this device (spec, "Dropbox provider" and
 * "Provider contract", connect step; map ticket 14). The provider owns its
 * login, tokens and revoke behind the connect step; this module owns what
 * is the same for every provider: keeping the secret in the Secret store,
 * the Connection in the Device store, the account check, setting up the
 * Remote's Metadata folder, and the local cleanup on disconnect.
 */
import type { AccountAccess, Authorization, ConnectStep } from "./connect-step";
import type { ConnectionEpoch } from "./connection-epoch";
import { NO_CONFLICTS } from "./conflicts";
import { detailField } from "./failure-detail";
import {
	providerSecretId,
	type Clock,
	type Connection,
	type DeviceIdentity,
	type DeviceStore,
	type SecretStore,
	type UiPort,
} from "./ports";
import { ProviderError, isFailure, isSyncable, type Provider, type ProviderErrorCategory } from "./provider";
import {
	DEFAULT_REMOTE_SETTINGS,
	DEVICES_FOLDER,
	METADATA_FOLDER,
	SETTINGS_PATH,
	deviceNameInFirstSync,
	devicePath,
	encodeDeviceRecord,
	encodeSettings,
	forgetDeviceRecord,
	readDeviceRecords,
	type DeviceRecord,
	type RemoteSettings,
} from "./remote-metadata";
import { statusOf } from "./status";

/**
 * Why connecting this device failed (spec of the review fixes, item 1): a
 * provider failure by its category; the service refusing the code; a
 * login to another account; a Remote name taken or holding a slash; a
 * folder the provider cannot sync; another device's First sync in
 * progress there; or an unexpected error, a `bug`.
 */
export type ConnectFailureCause =
	| ProviderErrorCategory
	| "codeRejected"
	| "otherAccount"
	| "nameTaken"
	| "invalidName"
	| "unsupportedProvider"
	| "firstSyncInProgress"
	| "bug";

/**
 * A failure while connecting this device: why, and what tells more when
 * there is something: the `failureDetail` of the error, or the name of
 * the device doing its First sync.
 */
export interface ConnectFailure {
	readonly cause: ConnectFailureCause;
	readonly detail?: string;
}

/**
 * A revoke on disconnect that failed other than by the login being refused
 * already (spec of the review fixes, item 3): the provider failure's
 * category, or `bug` for an unexpected error, and its `failureDetail` when
 * it has one to tell.
 */
export interface RevokeFailure {
	readonly cause: ProviderErrorCategory | "bug";
	readonly detail?: string;
}

/**
 * What connecting tells the UI: the status and lists a Connection changes,
 * and its failures, which the activity log keeps, while the connect window
 * and the disconnect notice tell the user themselves.
 */
export interface ConnectionUi extends Pick<UiPort, "showStatus" | "showSkipped" | "showConflicts"> {
	/** Reports a failure while connecting, for the activity log. */
	reportConnectFailure(failure: ConnectFailure): void;
	/** Reports a revoke on disconnect that failed, for the activity log. */
	reportRevokeFailure(failure: RevokeFailure): void;
}

/** Everything connecting and disconnecting is built from. */
export interface ConnectionPorts {
	readonly connectStep: ConnectStep;
	readonly deviceStore: DeviceStore;
	readonly secretStore: SecretStore;
	readonly ui: ConnectionUi;
	/** Returns a new random Device ID. */
	readonly newDeviceId: () => string;
	/** This device's clock, against which another device's "First sync in progress" mark is judged stale. */
	readonly clock: Clock;
	/** The Connection epoch, shared with the sync engine; Disconnect advances it. */
	readonly epoch: ConnectionEpoch;
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
	 * Ends this device's Connection: advances the Connection epoch, so a
	 * sync running meanwhile writes nothing more to this device's state and
	 * what the engine held for the Connection no longer holds; clears the
	 * secret and everything it keeps for the Connection, and empties the
	 * shown skipped-files and conflicts lists; then revokes the login at
	 * the service. Clearing first means a sync started while the service is
	 * asked finds no Connection. A revoke that fails, e.g. offline, is
	 * reported for the activity log and the outcome says so, since the user
	 * has to revoke the app in the service's own settings. The vault, the
	 * Remote and other devices are left untouched.
	 */
	disconnect(): Promise<DisconnectOutcome>;
	/**
	 * Renames this device to `name`, trimmed: stored in the Connection at
	 * once, so new conflict labels and messages use it, and written to its
	 * record in the Metadata folder by the next completed sync. An empty
	 * name is refused, changing nothing.
	 */
	renameDevice(name: string): Promise<RenameOutcome>;
	/**
	 * The records of the devices registered on this device's Remote, this
	 * one left out, read from the Metadata folder with a full listing.
	 */
	otherDevices(): Promise<readonly DeviceRecord[]>;
	/**
	 * "Forget this device": deletes the record `record`, as listed, from the
	 * Metadata folder. A record its device rewrote since it was listed is
	 * kept, since that device is still syncing; one already gone counts as
	 * forgotten.
	 */
	forgetDevice(record: DeviceRecord): Promise<ForgetOutcome>;
	/**
	 * The shared Remote settings as this device shows them: those a waiting
	 * change asks for, else those the last sync read; null before any sync
	 * read them.
	 */
	sharedSettings(): Promise<RemoteSettings | null>;
}

/**
 * How renaming this device ended: `renamed`, or `emptyName` when the name
 * was blank, or `notConnected` without a Connection to rename.
 */
export type RenameOutcome = { readonly kind: "renamed" | "emptyName" | "notConnected" };

/** How forgetting a device ended: `forgotten`, or `changed` when its device rewrote its record meanwhile. */
export type ForgetOutcome = { readonly kind: "forgotten" | "changed" };

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
 *   mistyped), answering `detail`; nothing was stored, and the login
 *   starts over;
 * - `otherAccount`: the device has a Connection to a different account, so
 *   the login is refused and nothing changes; switching accounts means
 *   disconnecting first;
 * - `reconnected`: the device has a Connection to the same account; the new
 *   secret replaces the old one and the Connection stays as it was, except
 *   that a pause for Reconnect needed ends.
 */
export type AuthorizationOutcome =
	| { readonly kind: "authorized"; readonly remotes: RemoteChooser }
	| { readonly kind: "codeRejected"; readonly detail?: string }
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
	 * device and stores the Connection. While another device's First sync
	 * there is in progress, it changes nothing and says so, unless
	 * `evenDuringFirstSync` asks to connect anyway.
	 */
	useFolder(root: string, deviceName: string, options?: { readonly evenDuringFirstSync?: boolean }): Promise<JoinOutcome>;
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
 * What choosing an existing folder led to: a `ConnectOutcome`, or
 * `firstSyncInProgress`: the device named `deviceName` is doing its First
 * sync there (spec, "Concurrency and the no-loss guarantee"), so this
 * device waits; nothing was written or stored.
 */
export type JoinOutcome = ConnectOutcome | { readonly kind: "firstSyncInProgress"; readonly deviceName: string };

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
	 * Runs one step of connecting; whatever it throws is reported for the
	 * activity log with its detail, a provider failure by its category and
	 * anything else as a bug, then thrown on to the connect window, which
	 * tells the user.
	 */
	async function reported<T>(step: () => Promise<T>): Promise<T> {
		try {
			return await step();
		} catch (error) {
			const cause = error instanceof ProviderError ? error.failure.category : "bug";
			ui.reportConnectFailure({ cause, ...detailField(error) });
			throw error;
		}
	}

	/** Reports `failure`, a refusal decided while connecting, and returns its `outcome`. */
	function refused<T>(outcome: T, failure: ConnectFailure): T {
		ui.reportConnectFailure(failure);
		return outcome;
	}

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
		if (!isSyncable(setup)) return refused({ kind: "unsupportedProvider" }, { cause: "unsupportedProvider" });
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

	/**
	 * Connects to the existing folder `root` (`connect`), unless another
	 * device's First sync is in progress there and `evenDuringFirstSync`
	 * is not set.
	 */
	async function join(
		access: AccountAccess,
		authorization: Authorization,
		root: string,
		deviceName: string,
		evenDuringFirstSync: boolean,
	): Promise<JoinOutcome> {
		const setup = access.openRoot(root);
		if (!evenDuringFirstSync && isSyncable(setup)) {
			const other = await deviceNameInFirstSync(setup, ports.clock.now());
			if (other !== null) {
				return refused({ kind: "firstSyncInProgress", deviceName: other }, { cause: "firstSyncInProgress", detail: other });
			}
		}
		return connect(access, authorization, root, deviceName);
	}

	/** The Remote choice offered after `authorization` logged in. */
	function remoteChooser(authorization: Authorization): RemoteChooser {
		const access = connectStep.access(authorization.secret);
		return {
			list(): Promise<readonly RemoteCandidate[]> {
				return reported(async () => {
					const roots = await access.listRoots(METADATA_FOLDER);
					return roots.map(({ root, name, holdsMarker }) => ({ root, name, isRemote: holdsMarker }));
				});
			},
			useFolder(root, deviceName, options = {}): Promise<JoinOutcome> {
				return reported(() => join(access, authorization, root, deviceName, options.evenDuringFirstSync === true));
			},
			createRemote(name: string, deviceName: string): Promise<CreateRemoteOutcome> {
				return reported(async () => {
					if (name.includes("/")) return refused({ kind: "invalidName" }, { cause: "invalidName" });
					let root: string;
					try {
						({ root } = await access.createRoot(name));
					} catch (error) {
						if (isFailure(error, "preconditionFailed")) return refused({ kind: "nameTaken" }, { cause: "nameTaken" });
						throw error;
					}
					return connect(access, authorization, root, deviceName);
				});
			},
		};
	}

	/** Applies the account check to a completed login. */
	async function outcomeOf(authorization: Authorization): Promise<AuthorizationOutcome> {
		const connection = await deviceStore.loadConnection();
		if (connection === null) return { kind: "authorized", remotes: remoteChooser(authorization) };
		if (connection.accountId !== authorization.accountId) return refused({ kind: "otherAccount" }, { cause: "otherAccount" });
		secretStore.setSecret(secretId, authorization.secret);
		// The new secret ends a pause for a refused login; the Snapshot and Bases were kept, so syncing goes on normally.
		// Read after storing the secret, so a pause a failing sync stored meanwhile ends too.
		const current = await deviceStore.loadConnection();
		if (current?.reconnectNeeded === true) await deviceStore.saveConnection({ ...current, reconnectNeeded: false });
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
			const attempt = await reported(() => connectStep.startAuthorization());
			return {
				authorizeUrl: attempt.authorizeUrl,
				submitCode(code: string): Promise<AuthorizationOutcome> {
					return reported(async () => {
						let authorization: Authorization;
						try {
							authorization = await attempt.complete(code);
						} catch (error) {
							if (isFailure(error, "auth")) {
								const answer = detailField(error);
								return refused({ kind: "codeRejected", ...answer }, { cause: "codeRejected", ...answer });
							}
							throw error;
						}
						return outcomeOf(authorization);
					});
				},
			};
		},

		async disconnect(): Promise<DisconnectOutcome> {
			ports.epoch.advance();
			const secret = secretStore.getSecret(secretId);
			secretStore.deleteSecret(secretId);
			await deviceStore.clear();
			ui.showStatus({ state: "notConnected" });
			// What the last sync skipped and left in conflict belonged to the Remote just left.
			ui.showSkipped([]);
			ui.showConflicts(NO_CONFLICTS);
			if (secret === null) return { kind: "disconnected" };
			try {
				await connectStep.access(secret).revoke();
				return { kind: "disconnected" };
			} catch (error) {
				// A refused secret is already revoked; any other failure, an
				// unexpected one included, leaves it possibly valid.
				if (isFailure(error, "auth")) return { kind: "disconnected" };
				const cause = error instanceof ProviderError ? error.failure.category : "bug";
				ui.reportRevokeFailure({ cause, ...detailField(error) });
				return { kind: "revokeFailed" };
			}
		},

		async renameDevice(name: string): Promise<RenameOutcome> {
			const trimmed = name.trim();
			if (trimmed === "") return { kind: "emptyName" };
			const connection = await deviceStore.loadConnection();
			if (connection === null) return { kind: "notConnected" };
			if (trimmed !== connection.device.name) {
				await deviceStore.saveConnection({
					...connection,
					device: { ...connection.device, name: trimmed },
					deviceRecordOutdated: true,
				});
			}
			return { kind: "renamed" };
		},

		async otherDevices(): Promise<readonly DeviceRecord[]> {
			const { connection, remote } = await connectedRemote();
			const records = await readDeviceRecords(remote);
			return records.filter((record) => record.device.id !== connection.device.id);
		},

		async forgetDevice(record: DeviceRecord): Promise<ForgetOutcome> {
			const { remote } = await connectedRemote();
			try {
				await forgetDeviceRecord(remote, record);
			} catch (error) {
				if (isFailure(error, "preconditionFailed")) return { kind: "changed" };
				if (!isFailure(error, "notFound")) throw error;
			}
			return { kind: "forgotten" };
		},

		async sharedSettings(): Promise<RemoteSettings | null> {
			return (await deviceStore.loadSettingsChange())?.wanted ?? (await deviceStore.loadKnownSettings());
		},
	};

	/**
	 * This device's Connection and its Remote, reached with the stored
	 * secret. Rejects without either: the settings tab offers the device
	 * list only while connected, and a missing secret is Reconnect needed.
	 */
	async function connectedRemote(): Promise<{ readonly connection: Connection; readonly remote: Provider }> {
		const connection = await deviceStore.loadConnection();
		const secret = secretStore.getSecret(secretId);
		if (connection === null || secret === null) throw new ProviderError({ category: "auth" }, "no Connection with a secret");
		return { connection, remote: connectStep.access(secret).openRoot(connection.remoteRoot) };
	}
}
