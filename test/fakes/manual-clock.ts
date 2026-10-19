import type { Clock } from "../../src/engine/ports";

/** A Clock that moves only when a test advances it. */
export class ManualClock implements Clock {
	/** @param time the starting time, in ms since the epoch */
	constructor(private time = 0) {}

	now(): number {
		return this.time;
	}

	/** Moves the clock forward by `ms`. */
	advance(ms: number): void {
		this.time += ms;
	}
}
