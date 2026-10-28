// A Vitest reporter for the desktop and Android runs: after the usual
// output, one line per manual check (check-summary.ts). Its options name the
// checks the run covers: `["./check-reporter.ts", { checks: [3, 8] }]`.
import type { Reporter, TestCase, TestModule, Vitest } from "vitest/node";
import { checkSummary, outcomeOf, type TestOutcome } from "./check-summary";

/** Prints the manual checks' summary once the run ends. */
export default class CheckReporter implements Reporter {
	private vitest: Vitest | undefined;
	private readonly checks: readonly number[];

	/** @param options `checks`: the manual checks the run covers, each printed even if none of its tests was collected */
	constructor(options: { readonly checks?: readonly number[] } = {}) {
		this.checks = options.checks ?? [];
	}

	/** Keeps Vitest, whose logger prints the summary. */
	onInit(vitest: Vitest): void {
		this.vitest = vitest;
	}

	/** Prints one line per manual check, from every test of the run. */
	onTestRunEnd(testModules: readonly TestModule[]): void {
		const outcomes: TestOutcome[] = [];
		for (const module of testModules) {
			for (const test of module.children.allTests()) {
				const result = test.result();
				const reported = { fullName: test.fullName, state: result.state, errors: result.errors?.map((error) => error.message) };
				outcomes.push(outcomeOf(reported, errorsAbove(test)));
			}
		}
		const lines = checkSummary(outcomes, this.checks);
		if (lines.length === 0) return;
		this.vitest?.logger.log(["", "Manual checks:", ...lines.map((line) => `  ${line}`)].join("\n"));
	}
}

/** The error messages of the describes and the file above `test`, nearest first: a failing hook's error is there. */
function errorsAbove(test: TestCase): string[] {
	const messages: string[] = [];
	for (let parent = test.parent; ; parent = parent.parent) {
		messages.push(...parent.errors().map((error) => error.message));
		if (parent.type === "module") return messages;
	}
}
