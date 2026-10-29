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

/** The errors above a test, each nearest first: those of the describes around it, and those of its file. */
export interface ErrorsAbove {
	readonly describes: readonly string[];
	readonly file: readonly string[];
}

/**
 * The outcome of `test`, given the errors above it. A failed test keeps its
 * own error. A test that passed is a failure with the error of the nearest
 * describe around it that has one, such as a failing `afterAll`, so the
 * summary never says passed for a check whose describe failed. A test that
 * did not run (Vitest marks one a failing hook kept from running skipped,
 * the error on its describe) is a failure with the nearest error of its
 * describes, else of its file, so the summary tells why a check did not run.
 * The file's errors are not held against a test that passed, so a failing
 * file teardown does not fail every check of the file.
 */
export function outcomeOf(test: ReportedTest, above: ErrorsAbove): TestOutcome {
	const { fullName, state } = test;
	if (state === "failed") return { fullName, state, error: test.errors?.[0] };
	const error = above.describes[0] ?? (state === "passed" ? undefined : above.file[0]);
	if (error !== undefined) return { fullName, state: "failed", error };
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
