import { runInThisContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { evalProgram, parseEvalAnswer, readAnswer } from "./obsidian-cli";

describe("the program sent to the Obsidian CLI's eval", () => {
	it("runs the body as an async function and answers its value as JSON", async () => {
		const answer = await runInPage(evalProgram("return { a: 1, b: [2, 3] };"));
		expect(parseEvalAnswer(`=> ${answer}`)).toEqual({ a: 1, b: [2, 3] });
	});

	it("waits for what the body awaits", async () => {
		const answer = await runInPage(evalProgram("await wait(10); return 'late';"));
		expect(parseEvalAnswer(`=> ${answer}`)).toBe("late");
	});

	it("gives the body until(), which waits for a truthy value", async () => {
		const program = evalProgram("let n = 0; return await until(() => (++n >= 3 ? n : null), 1000);");
		expect(parseEvalAnswer(`=> ${await runInPage(program)}`)).toBe(3);
	});

	it("answers undefined for a body that returns nothing", async () => {
		expect(parseEvalAnswer(`=> ${await runInPage(evalProgram("const x = 1;"))}`)).toBeUndefined();
	});

	it("turns a thrown error into an error of the caller, with its message", async () => {
		const answer = await runInPage(evalProgram("throw new Error('boom');"));
		expect(() => parseEvalAnswer(`=> ${answer}`)).toThrow(/in Obsidian: .*boom/);
	});

	it("turns until() running out of time into an error naming the wait", async () => {
		const answer = await runInPage(evalProgram("return await until(() => null, 30, 'the panel');"));
		expect(() => parseEvalAnswer(`=> ${answer}`)).toThrow(/the panel/);
	});
});

describe("reading the CLI's answer", () => {
	it("refuses output that is not an eval answer, quoting it", () => {
		expect(() => parseEvalAnswer("Command line interface is not enabled.\n")).toThrow(
			/Obsidian CLI: Command line interface is not enabled\./,
		);
	});

	it("refuses an answer that is not the program's JSON", () => {
		expect(() => parseEvalAnswer("=> 2")).toThrow(/not the eval program's answer: 2/);
	});

	it("reads an answer the CLI ended with a line break", () => {
		expect(parseEvalAnswer('=> {"value":"x"}\n')).toBe("x");
	});
});

describe("reading the program's answer", () => {
	it("is the value it answered, or undefined for none", () => {
		expect(readAnswer('{"value":{"a":1}}')).toEqual({ a: 1 });
		expect(readAnswer("{}")).toBeUndefined();
	});

	it("throws the page's error", () => {
		expect(() => readAnswer('{"error":"Error: boom"}')).toThrow(/in Obsidian: Error: boom/);
	});

	it("refuses what is not the program's JSON, or not a string at all", () => {
		expect(() => readAnswer("2")).toThrow(/not the eval program's answer: 2/);
		expect(() => readAnswer("{oops")).toThrow(/not the eval program's answer: \{oops/);
		expect(() => readAnswer(undefined)).toThrow(/not the eval program's answer: undefined/);
	});
});

/** Evaluates `program` as the CLI's eval does: an expression whose value, a promise of a string here, is the answer. */
async function runInPage(program: string): Promise<string> {
	return String(await (runInThisContext(program) as Promise<unknown>));
}
