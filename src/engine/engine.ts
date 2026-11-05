/**
 * The sync engine: all sync logic, provider-agnostic, reaching the outside
 * world only through its ports (spec, "Architecture and modules", "Sync
 * triggers and lifecycle"). The shell builds one per device with
 * `createSyncEngine`.
 */
import { ConnectionChanged, boundToEpoch } from "./connection-epoch";
import { detailField } from "./failure-detail";
import { withVaultWrites } from "./local-vault";
import { isWithin, movedAlong } from "./paths";
import type { VaultRename } from "./renames";
import { providerSecretId, type DeviceStore, type EnginePorts, type Scheduler } from "./ports";
import { ProviderError, isSyncable } from "./provider";
import { beginFirstSync, updateDeviceRecord } from "./first-sync";
import { conflictsOf } from "./conflicts";
import { readRemoteSettings, type RemoteSettings } from "./remote-metadata";
import { applySettingsChange, sameSettings } from "./settings-change";
import { statusOf, type SyncFailureCause, type SyncStatus } from "./status";
import { runSync, type SyncHold } from "./sync-run";
import type { SyncSnapshot } from "./sync-snapshot";

/** First backoff wait after a transient failure, in milliseconds. */
const INITIAL_BACKOFF_MS = 5_000;

/** Longest backoff wait between transient retries, in milliseconds (5 min). */
const MAX_BACKOFF_MS = 5 * 60 * 1_000;

/** What a trigger asks for: a sync, or a Full reconcile, which lists the Remote in full. */
type SyncKind = "sync" | "reconcile";

/**
 * Who asked for a sync: the `user` ("Sync now", "Full reconcile"), or an
 * `automatic` trigger (vault open, the post-edit pause, polling, the app
 * becoming visible or going online). Only the user lifts a hold of the
 * Deletion guard.
 */
type SyncSource = "user" | "automatic";

/** A started engine, as `start` returns it. */
interface StartedEngine {
	/** Unsubscribes from the vault and cancels every timer; the shell calls it when the plugin unloads. */
	readonly stop: () => void;
	/** Settles once the Connection's status is shown and, when connected, the vault-open sync has run. */
	readonly opened: Promise<void>;
}

/** One device's sync engine. */
export interface SyncEngine {
	/**
	 * Starts the engine once the vault is open (`workspace.onLayoutReady`):
	 * subscribes at once to vault change hints, for the post-edit pause and
	 * as rename hints (renames.ts), and schedules periodic polling, then
	 * shows this device's Connection status and, when connected, the
	 * conflicts its Sync snapshot records, and runs the vault-open sync.
	 */
	start(): StartedEngine;
	/**
	 * Syncs this device once, showing Syncing… and then Synced, Offline on
	 * a `transient` failure, or Sync failed on another provider failure or
	 * a provider that cannot be synced (`isSyncable`). A device without a
	 * Connection only shows Not connected.
	 *
	 * An `auth` failure, or a Connection without its secret, pauses sync on
	 * this device until the user logs in again: the pause is stored with
	 * the Connection, told once with a notice, and every sync meanwhile
	 * only shows Reconnect needed, reaching nothing. Any triggers that fire while a
	 * sync is running collapse into one follow-up sync immediately after it
	 * finishes. Errors that are not provider failures are bugs: the status
	 * shows Sync failed and the error is thrown.
	 *
	 * When the Deletion guard's prompt was closed without an answer, sync
	 * is held: it shows Deletions waiting for you and does nothing more
	 * until a sync from the `user` ("Sync now", the default `source`),
	 * which asks again. The hold lives in memory only, and ends with the
	 * Connection: after Disconnect (the Connection epoch), the next sync
	 * asks afresh. A settings change waiting on this device is brought to
	 * the Remote first (`changeSettings`); its collision prompt, closed
	 * without an answer, holds sync the same way, showing the settings
	 * collision.
	 */
	sync(source?: SyncSource): Promise<void>;
	/**
	 * Syncs this device once, listing the Remote in full instead of using
	 * its change feed ("Full reconcile").
	 */
	reconcile(): Promise<void>;
	/**
	 * "Restore local" of a configuration conflict: asks for a sync from the
	 * user that, before it lists anything, writes the kept version `id`
	 * back over its configuration file, creating its folders where missing,
	 * and takes it off the list; the sync then uploads it as an edit made
	 * here and shows the list left. Applied inside the sync, the restore
	 * never overlaps one under way: it waits for the next. An id no longer
	 * kept does nothing; one asked for while sync cannot run waits, in
	 * memory, for the next sync that does.
	 */
	restoreConfiguration(id: string): Promise<void>;
	/**
	 * "Apply to all devices": asks for a sync from the user that brings the
	 * shared Remote settings to `wanted`, edited from `base`, the settings
	 * the user saw, on the Remote (settings-change.ts). Only what differs
	 * from `base` is this device's change, so a setting another device
	 * changed since stays. The change is stored on this device first, so it
	 * outlives a restart and a sync that cannot run. Edited from the change
	 * still waiting, it joins that one, keeping the settings it was made
	 * from.
	 */
	changeSettings(base: RemoteSettings, wanted: RemoteSettings): Promise<void>;
}

/** A sync under way and what follows it. */
interface Run {
	/** Settles when this sync and its follow-ups are done. */
	done: Promise<void>;
	/** What this sync is; a reconcile request before it lists the Remote upgrades it. */
	kind: SyncKind;
	/**
	 * Whether it has begun to list the vault and the Remote: a trigger
	 * before that joins it, one after needs a follow-up.
	 */
	listing: boolean;
	/** The sync to run after this one, a Full reconcile if any trigger asked for one. */
	followUp: SyncKind | undefined;
}

/** One pending task at a time on `scheduler`: scheduling again replaces it. */
interface Timer {
	/** Runs `task` after `delayMs`, cancelling the task pending, if any. */
	schedule(delayMs: number, task: () => void): void;
	/** Cancels the pending task, if any. */
	cancel(): void;
}

/** A Timer over `scheduler` that schedules nothing once `isStopped` says so. */
function timerOn(scheduler: Scheduler, isStopped: () => boolean): Timer {
	let cancelPending: (() => void) | undefined;
	return {
		schedule(delayMs, task) {
			cancelPending?.();
			cancelPending = undefined;
			if (isStopped()) return;
			cancelPending = scheduler.schedule(delayMs, () => {
				cancelPending = undefined;
				task();
			});
		},
		cancel() {
			cancelPending?.();
			cancelPending = undefined;
		},
	};
}

/**
 * What holds sync until the user asks for one: a prompt of the sync itself
 * (`SyncHold`), or the collision prompt of a settings change, closed.
 */
type Hold = SyncHold | "settingsCollision";

/** The status shown while sync is held by `hold`. */
function heldStatus(hold: Hold): SyncStatus {
	switch (hold) {
		case "deletions":
			return { state: "deletionsOnHold" };
		case "firstSync":
			return { state: "firstSyncWaiting" };
		case "settingsCollision":
			return { state: "settingsCollision" };
	}
}

/** Sync failed for `cause`, on `error`, with its detail when it has one to tell. */
function failedOn(cause: SyncFailureCause, error: unknown): SyncStatus {
	return { state: "syncFailed", cause, ...detailField(error) };
}

/** Builds a sync engine over `ports`. */
export function createSyncEngine(ports: EnginePorts): SyncEngine {
	const {
		deviceStore,
		secretStore,
		configurationConflicts,
		providers,
		vault,
		clock,
		scheduler,
		ui,
		schedule,
		deletionGuard,
		configurationCategories,
		pluginDir,
		pluginId,
		newDeviceId,
		epoch,
		reportError,
	} = ports;
	/** The sync running now, if any. */
	let running: Run | undefined;
	/** The Connection epoch the hold and the rename hints belong to; Disconnect moves past it. */
	let stateEpoch = epoch.current();
	/** How many of the engine's own vault writes are under way; their change hints are not edits. */
	let ownWrites = 0;
	let backoffAttempt = 0;
	/** What holds sync until the user asks for one, if anything. */
	let held: Hold | undefined;
	/** How many syncs the user has asked for; a hold is not set over a request made while its prompt was open. */
	let userRequests = 0;
	/**
	 * The user's renames in the vault since the last completed sync, in
	 * order: hints for finding renames, in memory only.
	 */
	const renameHints: VaultRename[] = [];
	/** How many conflicts reports have started, so a late one does not replace a newer one. */
	let conflictReports = 0;
	/** The kept configuration versions the user chose to restore, in order, for the next sync to write back. */
	const restores: string[] = [];
	/** The engine's own vault renames under way: the rename events they cause are not the user's. */
	const ownRenames: VaultRename[] = [];
	let stopped = false;
	const isStopped = (): boolean => stopped;
	const editPause = timerOn(scheduler, isStopped);
	const poll = timerOn(scheduler, isStopped);
	const retry = timerOn(scheduler, isStopped);

	/** Runs `work`, one of the engine's own vault writes. */
	async function ownWrite<T>(work: () => Promise<T>): Promise<T> {
		ownWrites += 1;
		try {
			return await work();
		} finally {
			ownWrites -= 1;
		}
	}

	/** `vault` with its writes marked as the engine's own, so they do not start the post-edit pause. */
	const syncVault = withVaultWrites(vault, {
		write: (path, data) => ownWrite(() => vault.write(path, data)),
		replace: (path, expected, data) => ownWrite(() => vault.replace(path, expected, data)),
		createFolder: (path) => ownWrite(() => vault.createFolder(path)),
		trash: (path) => ownWrite(() => vault.trash(path)),
		rename: async (from, to) => {
			const own = { from, to };
			ownRenames.push(own);
			try {
				await ownWrite(() => vault.rename(from, to));
			} finally {
				ownRenames.splice(ownRenames.indexOf(own), 1);
			}
		},
	});

	/** Whether the rename of `from` to `to` is one of the engine's own, or inside a folder it renames. */
	function isOwnRename(from: string, to: string): boolean {
		return ownRenames.some((own) => isWithin(from, own.from) && to === movedAlong(from, own.from, own.to));
	}

	/**
	 * Shows the conflicts `snapshot` records, the stored Sync snapshot when
	 * none is given, with the kept configuration versions. A report that
	 * finishes after one started later is stale and not shown, nor is one
	 * that finishes once `stillShown` says its Connection was disconnected.
	 */
	async function showConflicts(snapshot?: SyncSnapshot, stillShown: () => boolean = () => true): Promise<void> {
		conflictReports += 1;
		const report = conflictReports;
		const [shown, kept] = await Promise.all([snapshot ?? deviceStore.loadSnapshot(), configurationConflicts.list()]);
		if (report === conflictReports && stillShown()) ui.showConflicts(conflictsOf(shown, kept));
	}

	/** Schedules the next periodic poll. */
	function scheduleNextPoll(): void {
		poll.schedule(schedule().pollInterval.ms, () => {
			scheduleNextPoll();
			syncOnItsOwn();
		});
	}

	/**
	 * Drops what the engine kept in memory for a Connection since
	 * disconnected: a hold, which the next Connection must not inherit; the
	 * restores asked for, of versions kept under that Connection; the
	 * backoff of its failures; and the rename hints, which name paths of
	 * the Remote left. The hints can do no harm anyway, since Disconnect
	 * cleared the Sync snapshot they are matched against: dropping them is
	 * defensive only.
	 */
	function forgetDisconnected(): void {
		if (epoch.isCurrent(stateEpoch)) return;
		stateEpoch = epoch.current();
		held = undefined;
		restores.length = 0;
		backoffAttempt = 0;
		renameHints.length = 0;
	}

	/**
	 * Pauses sync until the user logs in again, after the provider refused
	 * the secret `refused`, or none was stored (null): stores the pause with
	 * the Connection in `store`, tells the user once, and shows Reconnect
	 * needed. A secret replaced meanwhile, by a login during this sync, is
	 * not the one refused, so `run` syncs again with it instead, and a pause
	 * stored while that login ran is lifted again, since the login could not
	 * see it to clear it; a Connection gone meanwhile, by a disconnect, only
	 * has its status shown.
	 */
	async function pauseForReconnect(run: Run, refused: string | null, store: DeviceStore): Promise<void> {
		const loggedInAgain = (): boolean => secretStore.getSecret(providerSecretId(providers.providerId)) !== refused;
		const connection = await store.loadConnection();
		if (connection === null) {
			ui.showStatus(statusOf(connection));
			return;
		}
		if (loggedInAgain()) {
			run.followUp ??= "sync";
			return;
		}
		if (connection.reconnectNeeded !== true) {
			await store.saveConnection({ ...connection, reconnectNeeded: true });
			if (loggedInAgain()) {
				const current = await store.loadConnection();
				if (current !== null) await store.saveConnection({ ...current, reconnectNeeded: false });
				run.followUp ??= "sync";
				return;
			}
			ui.showNotice({ kind: "reconnectNeeded" });
		}
		ui.showStatus({ state: "reconnectNeeded" });
	}

	/**
	 * One sync of `run`, from reading the Connection to the final status.
	 * It belongs to the Connection epoch it starts in: its writes to this
	 * device's state go through a store bound to that epoch, and the epoch
	 * is checked after each wait that ends in something shown and after each
	 * prompt answered. Once Disconnect has moved past it, the sync ends
	 * showing nothing more (no status, list or notice), since Disconnect
	 * set what to show; a bug is still thrown.
	 */
	async function syncOnce(run: Run): Promise<void> {
		forgetDisconnected();
		const runEpoch = epoch.current();
		const store = boundToEpoch(deviceStore, epoch, runEpoch);
		/** Whether the epoch is still the one this sync started in. */
		const inRunEpoch = (): boolean => epoch.isCurrent(runEpoch);
		const connection = await store.loadConnection();
		if (connection === null) {
			ui.showStatus({ state: "notConnected" });
			return;
		}
		if (connection.reconnectNeeded === true) {
			ui.showStatus({ state: "reconnectNeeded" });
			return;
		}
		if (held !== undefined) {
			ui.showStatus(heldStatus(held));
			return;
		}
		const userRequestsBefore = userRequests;
		// Renames reported from now on are for the next sync.
		const hints = [...renameHints];
		ui.showStatus({ state: "syncing" });
		/** The secret this sync logs in with, for telling a refused login from one replaced meanwhile. */
		let secret: string | null = null;
		try {
			secret = secretStore.getSecret(providerSecretId(providers.providerId));
			if (secret === null) {
				// A Connection without its secret cannot reach the Remote; only a new login restores it.
				await pauseForReconnect(run, secret, store);
				return;
			}
			const provider = await providers.open(connection, secret);
			if (!isSyncable(provider)) {
				ui.showStatus({ state: "syncFailed", cause: "unsupportedProvider" });
				return;
			}
			// Shared settings this device cannot read could classify files differently from other devices.
			const stored = await readRemoteSettings(provider);
			if (stored === null) {
				ui.showStatus({ state: "syncFailed", cause: "unreadableSettings" });
				return;
			}
			run.listing = true;
			// A settings change asked for from now on is for the follow-up sync.
			const applied = await applySettingsChange(provider, store, ui, stored, inRunEpoch);
			if (applied.kind === "unreadable") {
				ui.showStatus({ state: "syncFailed", cause: "unreadableSettings" });
				return;
			}
			if (applied.kind === "held") {
				// A sync the user asked for meanwhile runs next and asks again.
				if (userRequests === userRequestsBefore) held = "settingsCollision";
				ui.showStatus(heldStatus("settingsCollision"));
				return;
			}
			const { settings } = applied;
			// Restores asked for from now on are for the follow-up sync.
			const restoring = [...restores];
			const isFirstSync = !(await store.hasSnapshot());
			const result = await runSync({
				provider,
				vault: syncVault,
				deviceStore: store,
				configurationConflicts,
				settings,
				device: connection.device,
				clock,
				ui,
				reconcile: run.kind === "reconcile",
				editPauseMs: schedule().editPause.ms,
				guard: deletionGuard(),
				configuration: { layout: { configDir: vault.configDir, pluginDir, pluginId }, categories: configurationCategories() },
				renameHints: hints,
				restores: restoring,
				inRunEpoch,
				...(isFirstSync ? { firstSync: { begin: () => beginFirstSync(store, provider, newDeviceId, clock) } } : {}),
			});
			if (!inRunEpoch()) return;
			backoffAttempt = 0;
			restores.splice(0, restoring.length);
			ui.showSkipped(result.skipped);
			await showConflicts(result.snapshot, inRunEpoch);
			if (!inRunEpoch()) return;
			if (result.held !== undefined) {
				// A sync the user asked for meanwhile runs next and asks again.
				if (userRequests === userRequestsBefore) held = result.held;
				ui.showStatus(heldStatus(result.held));
				return;
			}
			if (result.firstSync !== undefined) {
				await store.markSnapshotComplete();
				ui.showNotice({ kind: "firstSyncDone", ...result.firstSync });
			}
			await updateDeviceRecord(store, provider);
			if (!inRunEpoch()) return;
			renameHints.splice(0, hints.length);
			ui.showStatus({ state: "synced" });
			if (result.nextPostEditPauseMs !== undefined) {
				editPause.schedule(result.nextPostEditPauseMs, () => syncOnItsOwn());
			}
		} catch (error) {
			// The Connection was disconnected meanwhile: Disconnect showed the status, a bug is still thrown.
			if (error instanceof ConnectionChanged) return;
			if (!inRunEpoch() && error instanceof ProviderError) return;
			if (!(error instanceof ProviderError)) {
				if (inRunEpoch()) ui.showStatus(failedOn("bug", error));
				throw error;
			}
			if (error.failure.category === "auth") {
				try {
					await pauseForReconnect(run, secret, store);
				} catch (pauseError) {
					// Disconnected while pausing: nothing is left to pause.
					if (!(pauseError instanceof ConnectionChanged)) throw pauseError;
				}
				return;
			}
			if (error.failure.category === "transient") {
				ui.showStatus({ state: "offline" });
				const delayMs = Math.min(MAX_BACKOFF_MS, INITIAL_BACKOFF_MS * 2 ** backoffAttempt);
				backoffAttempt += 1;
				retry.schedule(delayMs, () => syncOnItsOwn());
				return;
			}
			ui.showStatus(failedOn(error.failure.category, error));
			if (error.failure.category === "throttled") {
				retry.schedule(error.failure.retryAfterMs, () => syncOnItsOwn());
			}
		}
	}

	/**
	 * Starts an automatic sync that no caller waits for: a bug it hits,
	 * shown as Sync failed already, goes to `reportError`, not into an
	 * unhandled rejection.
	 */
	function syncOnItsOwn(): void {
		trigger("sync").catch((error: unknown) => reportError(error));
	}

	/**
	 * Starts a sync of `kind`, or joins the one running: before it lists,
	 * it simply becomes `kind` if that is a reconcile; after, every trigger
	 * collapses into one follow-up sync, a Full reconcile if any of them
	 * asked for one. A trigger from the `user` lifts a Deletion guard hold.
	 */
	function trigger(kind: SyncKind, source: SyncSource = "automatic"): Promise<void> {
		if (source === "user") {
			held = undefined;
			userRequests += 1;
		}
		retry.cancel();
		editPause.cancel();
		if (running !== undefined) {
			if (!running.listing) {
				if (kind === "reconcile") running.kind = kind;
			} else if (running.followUp !== "reconcile") {
				running.followUp = kind;
			}
			return running.done;
		}
		const run: Run = { done: Promise.resolve(), kind, listing: false, followUp: undefined };
		running = run;
		run.done = (async () => {
			try {
				for (;;) {
					await syncOnce(run);
					if (run.followUp === undefined) return;
					run.kind = run.followUp;
					run.followUp = undefined;
					run.listing = false;
				}
			} finally {
				running = undefined;
			}
		})();
		return run.done;
	}

	return {
		start(): StartedEngine {
			stopped = false;
			const unsubscribeVault = vault.onChange((hint) => {
				if (hint.kind === "renamed" && !isOwnRename(hint.oldPath, hint.path)) {
					renameHints.push({ from: hint.oldPath, to: hint.path });
				}
				if (ownWrites === 0) editPause.schedule(schedule().editPause.ms, () => syncOnItsOwn());
			});
			scheduleNextPoll();
			const stop = (): void => {
				stopped = true;
				unsubscribeVault();
				editPause.cancel();
				poll.cancel();
				retry.cancel();
			};
			const opened = (async () => {
				const connection = await deviceStore.loadConnection();
				ui.showStatus(statusOf(connection));
				if (connection === null) return;
				// What is known from earlier syncs shows at once, without holding up this sync, which may not finish.
				const outcomes = await Promise.allSettled([showConflicts(), stopped ? Promise.resolve() : trigger("sync")]);
				for (const outcome of outcomes) if (outcome.status === "rejected") throw outcome.reason;
			})();
			return { stop, opened };
		},

		sync(source: SyncSource = "user"): Promise<void> {
			return trigger("sync", source);
		},

		reconcile(): Promise<void> {
			return trigger("reconcile", "user");
		},

		restoreConfiguration(id: string): Promise<void> {
			restores.push(id);
			return trigger("sync", "user");
		},

		async changeSettings(base: RemoteSettings, wanted: RemoteSettings): Promise<void> {
			const pending = await deviceStore.loadSettingsChange();
			const joined = pending !== null && sameSettings(base, pending.wanted);
			await deviceStore.saveSettingsChange({ base: joined ? pending.base : base, wanted });
			return trigger("sync", "user");
		},
	};
}
