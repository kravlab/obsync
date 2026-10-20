/**
 * The sync engine: all sync logic, provider-agnostic, reaching the outside
 * world only through its ports (spec, "Architecture and modules", "Sync
 * triggers and lifecycle"). The shell builds one per device with
 * `createSyncEngine`.
 */
import type { LocalVault } from "./local-vault";
import { providerSecretId, type EnginePorts, type Scheduler } from "./ports";
import { ProviderError, isSyncable } from "./provider";
import { readRemoteSettings } from "./remote-metadata";
import { statusOf } from "./status";
import { runSync } from "./sync-run";

/** First backoff wait after a transient failure, in milliseconds. */
const INITIAL_BACKOFF_MS = 5_000;

/** Longest backoff wait between transient retries, in milliseconds (5 min). */
const MAX_BACKOFF_MS = 5 * 60 * 1_000;

/** What a trigger asks for: a sync, or a Full reconcile, which lists the Remote in full. */
type SyncKind = "sync" | "reconcile";

/** A started engine, as `start` returns it. */
export interface StartedEngine {
	/** Unsubscribes from the vault and cancels every timer; the shell calls it when the plugin unloads. */
	readonly stop: () => void;
	/** Settles once the Connection's status is shown and, when connected, the vault-open sync has run. */
	readonly opened: Promise<void>;
}

/** One device's sync engine. */
export interface SyncEngine {
	/**
	 * Starts the engine once the vault is open (`workspace.onLayoutReady`):
	 * subscribes at once to vault change hints for the post-edit pause and
	 * schedules periodic polling, then shows this device's Connection
	 * status and, when connected, runs the vault-open sync.
	 */
	start(): StartedEngine;
	/**
	 * Syncs this device once ("Sync now"), showing Syncing… and then Synced,
	 * Offline on a `transient` failure, or Sync failed on another provider
	 * failure or a provider that cannot be synced (`isSyncable`). A device
	 * without a Connection only shows Not connected. Any triggers that fire
	 * while a sync is running collapse into one follow-up sync immediately
	 * after it finishes. Errors that are not provider failures are bugs: the
	 * status shows Sync failed and the error is thrown.
	 */
	sync(): Promise<void>;
	/**
	 * Syncs this device once, listing the Remote in full instead of using
	 * its change feed ("Full reconcile").
	 */
	reconcile(): Promise<void>;
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

/** Builds a sync engine over `ports`. */
export function createSyncEngine(ports: EnginePorts): SyncEngine {
	const { deviceStore, secretStore, providers, vault, clock, scheduler, ui, schedule } = ports;
	/** The sync running now, if any. */
	let running: Run | undefined;
	/** How many of the engine's own vault writes are under way; their change hints are not edits. */
	let ownWrites = 0;
	let backoffAttempt = 0;
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
	const syncVault = new Proxy(vault, {
		get(target, property, receiver) {
			switch (property) {
				case "write":
					return (...args: Parameters<LocalVault["write"]>) => ownWrite(() => target.write(...args));
				case "replace":
					return (...args: Parameters<LocalVault["replace"]>) => ownWrite(() => target.replace(...args));
				case "createFolder":
					return (...args: Parameters<LocalVault["createFolder"]>) => ownWrite(() => target.createFolder(...args));
				case "trash":
					return (...args: Parameters<LocalVault["trash"]>) => ownWrite(() => target.trash(...args));
				case "rename":
					return (...args: Parameters<LocalVault["rename"]>) => ownWrite(() => target.rename(...args));
			}
			const value: unknown = Reflect.get(target, property, receiver);
			// Methods run on the vault itself, which may keep state on `this`.
			return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
		},
	});

	/** Schedules the next periodic poll. */
	function scheduleNextPoll(): void {
		poll.schedule(schedule().pollInterval.ms, () => {
			scheduleNextPoll();
			void trigger("sync");
		});
	}

	/** One sync of `run`, from reading the Connection to the final status. */
	async function syncOnce(run: Run): Promise<void> {
		const connection = await deviceStore.loadConnection();
		if (connection === null) {
			ui.showStatus({ state: "notConnected" });
			return;
		}
		ui.showStatus({ state: "syncing" });
		try {
			const secret = secretStore.getSecret(providerSecretId(providers.providerId));
			if (secret === null) {
				// A Connection without its secret cannot reach the Remote; a new
				// login (Reconnect, later) restores it.
				ui.showStatus({ state: "syncFailed" });
				return;
			}
			const provider = await providers.open(connection, secret);
			if (!isSyncable(provider)) {
				ui.showStatus({ state: "syncFailed" });
				return;
			}
			// Shared settings this device cannot read could classify files differently from other devices.
			const settings = await readRemoteSettings(provider);
			if (settings === null) {
				ui.showStatus({ state: "syncFailed" });
				return;
			}
			run.listing = true;
			const result = await runSync({
				provider,
				vault: syncVault,
				deviceStore,
				settings,
				device: connection.device,
				clock,
				ui,
				reconcile: run.kind === "reconcile",
				editPauseMs: schedule().editPause.ms,
			});
			backoffAttempt = 0;
			ui.showStatus({ state: "synced" });
			if (result.nextPostEditPauseMs !== undefined) {
				editPause.schedule(result.nextPostEditPauseMs, () => void trigger("sync"));
			}
		} catch (error) {
			if (!(error instanceof ProviderError)) {
				ui.showStatus({ state: "syncFailed" });
				throw error;
			}
			if (error.failure.category === "transient") {
				ui.showStatus({ state: "offline" });
				const delayMs = Math.min(MAX_BACKOFF_MS, INITIAL_BACKOFF_MS * 2 ** backoffAttempt);
				backoffAttempt += 1;
				retry.schedule(delayMs, () => void trigger("sync"));
				return;
			}
			ui.showStatus({ state: "syncFailed" });
			if (error.failure.category === "throttled") {
				retry.schedule(error.failure.retryAfterMs, () => void trigger("sync"));
			}
		}
	}

	/**
	 * Starts a sync of `kind`, or joins the one running: before it lists,
	 * it simply becomes `kind` if that is a reconcile; after, every trigger
	 * collapses into one follow-up sync, a Full reconcile if any of them
	 * asked for one.
	 */
	function trigger(kind: SyncKind): Promise<void> {
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
			const unsubscribeVault = vault.onChange(() => {
				if (ownWrites === 0) editPause.schedule(schedule().editPause.ms, () => void trigger("sync"));
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
				if (connection !== null && !stopped) await trigger("sync");
			})();
			return { stop, opened };
		},

		sync(): Promise<void> {
			return trigger("sync");
		},

		reconcile(): Promise<void> {
			return trigger("reconcile");
		},
	};
}
