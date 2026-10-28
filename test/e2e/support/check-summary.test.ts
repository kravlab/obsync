import { describe, expect, it } from "vitest";
import { checkSummary, outcomeOf } from "./check-summary";

describe("the summary of a run, one line per manual check", () => {
	it("says passed when every test of a check passed, in check order", () => {
		const lines = checkSummary([
			{ fullName: "check 8: conflict view > Reading view", state: "passed" },
			{ fullName: "check 3: connect error > is selectable", state: "passed" },
			{ fullName: "check 8: conflict view > Live Preview", state: "passed" },
		]);
		expect(lines).toEqual(["check 3: passed", "check 8: passed"]);
	});

	it("says failed with the first failing test and the first line of its error", () => {
		const lines = checkSummary([
			{ fullName: "check 8: conflict view > Reading view", state: "passed" },
			{ fullName: "check 8: conflict view > Live Preview", state: "failed", error: "expected [ 'quote' ]\n  to equal []" },
			{ fullName: "check 8: conflict view > other", state: "failed", error: "second" },
		]);
		expect(lines).toEqual(["check 8: failed: conflict view > Live Preview: expected [ 'quote' ]"]);
	});

	it("says failed when a test failed with no error text", () => {
		expect(checkSummary([{ fullName: "check 3: x", state: "failed" }])).toEqual(["check 3: failed: x"]);
	});

	it("says not run when no test of a check ran", () => {
		const lines = checkSummary([
			{ fullName: "check 14: buttons > first", state: "skipped" },
			{ fullName: "check 14: buttons > second", state: "pending" },
		]);
		expect(lines).toEqual(["check 14: not run"]);
	});

	it("counts a check with a skipped test and a passed one as passed", () => {
		const lines = checkSummary([
			{ fullName: "check 14: buttons > first", state: "skipped" },
			{ fullName: "check 14: buttons > second", state: "passed" },
		]);
		expect(lines).toEqual(["check 14: passed"]);
	});

	it("leaves out tests that name no check", () => {
		expect(checkSummary([{ fullName: "helpers > something", state: "failed", error: "x" }])).toEqual([]);
	});

	it("keeps a note the describe gives its check, such as what it leaves out", () => {
		const lines = checkSummary([{ fullName: "check 14 (partial: no First sync window): buttons > a", state: "passed" }]);
		expect(lines).toEqual(["check 14 (partial: no First sync window): passed"]);
	});

	it("says not run for a check the run covers when no test of it was collected", () => {
		const lines = checkSummary([{ fullName: "check 8: view > a", state: "passed" }], [3, 8]);
		expect(lines).toEqual(["check 3: not run", "check 8: passed"]);
	});
});

describe("the outcome of one test", () => {
	it("is the test's own result when it ran", () => {
		expect(outcomeOf({ fullName: "check 3: a", state: "failed", errors: ["own"] }, ["start failed"])).toEqual({
			fullName: "check 3: a",
			state: "failed",
			error: "own",
		});
		expect(outcomeOf({ fullName: "check 3: a", state: "passed" }, [])).toEqual({ fullName: "check 3: a", state: "passed" });
	});

	it("is a failure with its describe's error when a hook failing skipped it", () => {
		expect(outcomeOf({ fullName: "check 3: a", state: "skipped" }, ["start failed"])).toEqual({
			fullName: "check 3: a",
			state: "failed",
			error: "start failed",
		});
	});

	it("stays skipped when nothing above it failed", () => {
		expect(outcomeOf({ fullName: "check 3: a", state: "skipped" }, [])).toEqual({ fullName: "check 3: a", state: "skipped" });
	});
});
