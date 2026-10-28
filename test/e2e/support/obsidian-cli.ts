// What the desktop run sends to the Obsidian CLI's `eval` and reads back;
// the Android run sends the same programs over DevTools.
// The CLI evaluates an expression in Obsidian's window, awaits it if it is
// a promise, and prints `=> ` and its value; a thrown error prints as
// `Error: …`, with exit code 0 all the same. So every program is wrapped
// to answer one JSON object: `{"value": …}`, or `{"error": …}` for an error
// caught in the page, and anything else the CLI prints is its own failure.

/**
 * The expression that runs `body`, the body of an async function, in
 * Obsidian's window. Besides Obsidian's globals (`app`, `activeDocument`),
 * the body has two helpers:
 *
 * - `wait(ms)` resolves after `ms` milliseconds;
 * - `until(probe, ms = 10000, what = "the awaited state")` calls `probe`
 *   every 100 ms until it returns a truthy value, which it resolves with,
 *   and fails naming `what` after `ms`.
 *
 * Its value is the JSON answer `parseEvalAnswer` reads.
 */
export function evalProgram(body: string): string {
	return `(async () => {
	const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
	const until = async (probe, ms = 10000, what = "the awaited state") => {
		const end = Date.now() + ms;
		for (;;) {
			const value = await probe();
			if (value) return value;
			if (Date.now() >= end) throw new Error("timed out after " + ms + " ms waiting for " + what);
			await wait(100);
		}
	};
	try {
		const value = await (async () => {
${body}
		})();
		return JSON.stringify({ value });
	} catch (error) {
		return JSON.stringify({ error: String((error && error.stack) || error) });
	}
})()`;
}

/**
 * The value an `evalProgram` answered, from what the CLI printed. Throws
 * the page's error as `in Obsidian: …`, and anything the CLI printed
 * instead of an answer (e.g. that its interface is off) as `Obsidian CLI: …`.
 */
export function parseEvalAnswer(stdout: string): unknown {
	const text = stdout.trim();
	if (!text.startsWith("=> ")) throw new Error(`Obsidian CLI: ${text}`);
	return readAnswer(text.slice("=> ".length));
}

/**
 * The value in `answer`, the JSON string an `evalProgram` resolves with, as
 * the CLI prints it or DevTools returns it. Throws the page's error as
 * `in Obsidian: …`, and anything else as not the program's answer.
 */
export function readAnswer(answer: unknown): unknown {
	if (typeof answer !== "string") throw new Error(`not the eval program's answer: ${String(answer)}`);
	let parsed: unknown;
	try {
		parsed = JSON.parse(answer);
	} catch {
		throw new Error(`not the eval program's answer: ${answer}`);
	}
	if (typeof parsed !== "object" || parsed === null) throw new Error(`not the eval program's answer: ${answer}`);
	if ("error" in parsed) throw new Error(`in Obsidian: ${String(parsed.error)}`);
	return "value" in parsed ? parsed.value : undefined;
}
