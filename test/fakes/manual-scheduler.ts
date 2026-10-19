import type { Scheduler } from "../../src/engine/ports";
import type { ManualClock } from "./manual-clock";

/**
 * A Scheduler driven by a ManualClock: tasks run only when a test calls
 * `advance`, in the order they fall due.
 */
export class ManualScheduler implements Scheduler {
	private readonly tasks = new Set<{ readonly dueAt: number; readonly task: () => void }>();

	/** @param clock the clock tasks are timed against, advanced by `advance` */
	constructor(private readonly clock: ManualClock) {}

	schedule(delayMs: number, task: () => void): () => void {
		const entry = { dueAt: this.clock.now() + delayMs, task };
		this.tasks.add(entry);
		return () => this.tasks.delete(entry);
	}

	/** Moves the clock forward by `ms`, running every task that falls due. */
	advance(ms: number): void {
		this.clock.advance(ms);
		const due = [...this.tasks]
			.filter((entry) => entry.dueAt <= this.clock.now())
			.sort((a, b) => a.dueAt - b.dueAt);
		for (const entry of due) {
			this.tasks.delete(entry);
			entry.task();
		}
	}
}
