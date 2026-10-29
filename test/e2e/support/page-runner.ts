// Runs the scenarios' page programs in a test, over jsdom, as a run's
// Obsidian page does. For test files under `@vitest-environment jsdom`.
import { createContext, isContext, runInContext } from "node:vm";
import { evalProgram, readAnswer } from "./obsidian-cli";

/**
 * Runs `body` as a run's page does (`evalProgram`), with `globals` as the
 * page's global object, over jsdom's document: what one evaluation sets
 * there, such as a page flag, the next one sees. The page's clock moves a
 * second per reading, so a wait that is never met fails at once instead
 * of after its real time.
 */
export function runInPage(body: string, globals: Record<string, unknown>): Promise<unknown> {
	if (!isContext(globals)) {
		let clock = Date.now();
		Object.assign(globals, {
			activeDocument: document,
			document,
			Event,
			KeyboardEvent,
			setTimeout: (callback: () => void) => setTimeout(callback, 0),
			Date: { now: () => (clock += 1000) },
		});
		globals.window = globals;
		createContext(globals);
	}
	return (runInContext(evalProgram(body), globals) as Promise<unknown>).then(readAnswer);
}
