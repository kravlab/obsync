import { describe, expect, it } from "vitest";
import { ManualClock } from "./manual-clock";
import { ManualScheduler } from "./manual-scheduler";

describe("ManualScheduler", () => {
	it("runs a task once the clock has advanced past its delay", () => {
		const scheduler = new ManualScheduler(new ManualClock());
		const runs: string[] = [];
		scheduler.schedule(100, () => runs.push("task"));
		scheduler.advance(99);
		expect(runs).toEqual([]);
		scheduler.advance(1);
		scheduler.advance(1_000);
		expect(runs).toEqual(["task"]);
	});

	it("runs due tasks in time order", () => {
		const scheduler = new ManualScheduler(new ManualClock());
		const runs: string[] = [];
		scheduler.schedule(200, () => runs.push("later"));
		scheduler.schedule(100, () => runs.push("sooner"));
		scheduler.advance(300);
		expect(runs).toEqual(["sooner", "later"]);
	});

	it("never runs a cancelled task", () => {
		const scheduler = new ManualScheduler(new ManualClock());
		const runs: string[] = [];
		const cancel = scheduler.schedule(100, () => runs.push("task"));
		cancel();
		scheduler.advance(100);
		expect(runs).toEqual([]);
	});

	it("moves the shared clock forward", () => {
		const clock = new ManualClock(1_000);
		new ManualScheduler(clock).advance(250);
		expect(clock.now()).toBe(1_250);
	});
});
