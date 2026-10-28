// A process group a run starts (the emulator, with its helpers), tied to the
// run's own process: Node runs no `exit` listener when a signal ends the
// process, and a detached group gets no Ctrl+C of its own, so without this
// the group outlives an interrupted run.
import type { constants } from "node:os";

/** A signal by name, as `process.kill` takes it. */
export type Signal = keyof typeof constants.signals;

/** Sends `signal` to the process group `pid` leads, ignoring a group already gone. */
export function signalGroup(pid: number, signal: Signal): void {
	try {
		process.kill(-pid, signal);
	} catch (error) {
		if ((error as { code?: unknown }).code !== "ESRCH") throw error;
	}
}

/** The signals that end a run from outside: Ctrl+C, and a runner stopping its worker. */
const ENDING_SIGNALS = ["SIGINT", "SIGTERM"] as const;

/**
 * Kills the process group `pid` leads (SIGKILL) when this process exits,
 * or gets SIGINT or SIGTERM; after a signal the process still ends by it,
 * unless another listener of that signal stays to handle it. Returns the
 * function that unties them, for a group stopped on purpose.
 */
export function endGroupWithProcess(pid: number): () => void {
	const kill = () => signalGroup(pid, "SIGKILL");
	const onSignal = (signal: Signal) => {
		kill();
		// A listener stops Node's own ending on the signal: raised again, it ends the process as it would have.
		if (process.listenerCount(signal) === 0) process.kill(process.pid, signal);
	};
	process.once("exit", kill);
	for (const signal of ENDING_SIGNALS) process.once(signal, onSignal);
	return () => {
		process.off("exit", kill);
		for (const signal of ENDING_SIGNALS) process.off(signal, onSignal);
	};
}
