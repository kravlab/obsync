// The desktop and Android runs print what they found as one line per manual
// check (spec, "Desktop and Android runs"). A test belongs to the check its
// top-level describe names, as `check 8: …`, or `check 14 (partial: …): …`
// when the run covers only part of that check.

/** One finished test, as the summary needs it. */
export interface TestOutcome {
	/** The test's name with its describes, joined by ` > `. */
	readonly fullName: string;
	readonly state: "passed" | "failed" | "skipped" | "pending";
	/** The first error's message, for a failed test. */
	readonly error?: string;
}

/** A test as Vitest reports it: its own result, with every error message. */
export interface ReportedTest {
	readonly fullName: string;
	readonly state: TestOutcome["state"];
	readonly errors?: readonly string[];
}

const CHECK_NAME = /^check (\d+)( \([^)]*\))?: (.*)$/s;

/**
 * The outcome of `test`, given the errors of the describes and file above
 * it (`aboveErrors`, nearest first). A test a failing hook kept from running
 * (Vitest marks it skipped, the error on its describe) is a failure with
 * that error, so the summary tells why a check did not run.
 */
export function outcomeOf(test: ReportedTest, aboveErrors: readonly string[]): TestOutcome {
	const { fullName, state } = test;
	if (state === "failed") return { fullName, state, error: test.errors?.[0] };
	if (state !== "passed" && aboveErrors.length > 0) return { fullName, state: "failed", error: aboveErrors[0] };
	return { fullName, state };
}

/**
 * One line per manual check, in check order: each check the tests name,
 * and each of `expected`, the checks the run covers, so a check whose tests
 * were never collected still shows. `passed` when every test that ran
 * passed; `failed:` with the first failing test's name (after the check)
 * and the first line of its error; `not run` when none of its tests ran. A
 * check's note, such as `(partial: …)`, stays after its number. Tests that
 * name no check are left out.
 */
export function checkSummary(outcomes: readonly TestOutcome[], expected: readonly number[] = []): string[] {
	const byCheck = new Map<number, { note: string; tests: TestOutcome[] }>();
	for (const check of expected) byCheck.set(check, { note: "", tests: [] });
	for (const outcome of outcomes) {
		const match = CHECK_NAME.exec(outcome.fullName);
		if (!match) continue;
		const check = Number(match[1]);
		const entry = byCheck.get(check) ?? { note: "", tests: [] };
		entry.note ||= match[2] ?? "";
		entry.tests.push({ ...outcome, fullName: match[3] ?? "" });
		byCheck.set(check, entry);
	}
	return [...byCheck.entries()]
		.sort(([a], [b]) => a - b)
		.map(([check, { note, tests }]) => `check ${check}${note}: ${verdict(tests)}`);
}

/** The verdict of one check's tests. */
function verdict(tests: readonly TestOutcome[]): string {
	const failed = tests.find((test) => test.state === "failed");
	if (failed) {
		const reason = failed.error?.split("\n")[0];
		return reason ? `failed: ${failed.fullName}: ${reason}` : `failed: ${failed.fullName}`;
	}
	return tests.some((test) => test.state === "passed") ? "passed" : "not run";
}
