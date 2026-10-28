import { afterEach, describe, expect, it, vi } from "vitest";
import { DevToolsPage, evaluationValue, pageSocketUrl } from "./devtools";

/** A WebSocket in memory: records what is sent and lets a test answer. */
class FakeSocket extends EventTarget {
	static last: FakeSocket | undefined;
	/** Whether a new socket opens; false leaves its handshake hanging. */
	static opens = true;
	readonly sent: unknown[] = [];

	constructor(readonly url: string) {
		super();
		FakeSocket.last = this;
		if (FakeSocket.opens) queueMicrotask(() => this.dispatchEvent(new Event("open")));
	}

	send(data: string): void {
		this.sent.push(JSON.parse(data));
	}

	/** Starts closing, as a real WebSocket does: its close event comes later, if at all, never from within close(). */
	close(): void {
		this.closing = true;
	}

	closing = false;

	/** Ends the connection from the endpoint's side, as when the app's process dies. */
	drop(): void {
		this.dispatchEvent(new Event("close"));
	}

	/** Delivers `message` to the page's listener, as the endpoint would. */
	answer(message: unknown): void {
		this.deliver(JSON.stringify(message));
	}

	/** Delivers the frame `data` as it is. */
	deliver(data: string): void {
		this.dispatchEvent(Object.assign(new Event("message"), { data }));
	}
}

/** Opens a DevToolsPage on the fake endpoint, which lists one page. */
async function openFakePage(): Promise<{ page: DevToolsPage; socket: FakeSocket }> {
	vi.stubGlobal("WebSocket", FakeSocket);
	vi.stubGlobal("fetch", (url: string) => {
		expect(url).toBe("http://127.0.0.1:9222/json");
		return Promise.resolve(new Response(JSON.stringify([{ type: "page", webSocketDebuggerUrl: "ws://page" }])));
	});
	const page = await DevToolsPage.open(9222);
	if (!FakeSocket.last) throw new Error("no socket");
	return { page, socket: FakeSocket.last };
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
	FakeSocket.opens = true;
});

describe("opening a page over DevTools", () => {
	it("fails when the endpoint does not answer its list in time", async () => {
		vi.stubGlobal("WebSocket", FakeSocket);
		vi.stubGlobal(
			"fetch",
			(_url: string, init?: { signal?: AbortSignal }) =>
				new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason as Error))),
		);
		await expect(DevToolsPage.open(9222, 50)).rejects.toThrow(/DevTools: no answer from port 9222 within 50 ms/);
	});

	it("fails when the page's connection does not open in time", async () => {
		vi.stubGlobal("WebSocket", FakeSocket);
		vi.stubGlobal("fetch", () => Promise.resolve(new Response(JSON.stringify([{ type: "page", webSocketDebuggerUrl: "ws://page" }]))));
		FakeSocket.opens = false;
		await expect(DevToolsPage.open(9222, 50)).rejects.toThrow(/DevTools: the page's connection did not open within 50 ms/);
		expect(FakeSocket.last?.closing).toBe(true);
	});
});

describe("a page open over DevTools", () => {
	it("connects to the page the endpoint lists and evaluates as a user's gesture, awaiting by value", async () => {
		const { page, socket } = await openFakePage();
		const value = page.evaluate("1 + 1", 1000);
		expect(socket.url).toBe("ws://page");
		expect(socket.sent).toEqual([
			{ id: 1, method: "Runtime.evaluate", params: { expression: "1 + 1", awaitPromise: true, returnByValue: true, userGesture: true } },
		]);
		socket.answer({ id: 1, result: { result: { value: 2 } } });
		expect(await value).toBe(2);
	});

	it("matches each answer to its evaluation by id", async () => {
		const { page, socket } = await openFakePage();
		const first = page.evaluate("'a'", 1000);
		const second = page.evaluate("'b'", 1000);
		socket.answer({ id: 2, result: { result: { value: "b" } } });
		socket.answer({ id: 1, result: { result: { value: "a" } } });
		expect([await first, await second]).toEqual(["a", "b"]);
	});

	it("fails an evaluation with the page's exception", async () => {
		const { page, socket } = await openFakePage();
		const value = page.evaluate("boom()", 1000);
		socket.answer({ id: 1, result: { exceptionDetails: { exception: { description: "ReferenceError: boom" } } } });
		await expect(value).rejects.toThrow(/in the page: ReferenceError: boom/);
	});

	it("fails an evaluation that gets no answer in time", async () => {
		const { page } = await openFakePage();
		vi.useFakeTimers();
		const value = page.evaluate("new Promise(() => {})", 500);
		vi.advanceTimersByTime(500);
		await expect(value).rejects.toThrow(/no answer within 500 ms/);
	});

	it("closes the connection and fails the evaluations still waiting at once", async () => {
		const { page, socket } = await openFakePage();
		const value = page.evaluate("new Promise(() => {})", 1000);
		page.close();
		expect(socket.closing).toBe(true);
		await expect(value).rejects.toThrow(/connection closed/);
	});

	it("fails the evaluations still waiting when the page's end drops the connection", async () => {
		const { page, socket } = await openFakePage();
		const value = page.evaluate("new Promise(() => {})", 1000);
		socket.drop();
		await expect(value).rejects.toThrow(/connection closed/);
	});

	it("fails an evaluation asked once the connection is closed at once, sending nothing", async () => {
		const { page, socket } = await openFakePage();
		page.close();
		vi.useFakeTimers();
		await expect(page.evaluate("1", 60_000)).rejects.toThrow(/connection closed/);
		expect(socket.sent).toEqual([]);
	});

	it("fails an evaluation asked once the page's end dropped the connection at once, sending nothing", async () => {
		const { page, socket } = await openFakePage();
		socket.drop();
		vi.useFakeTimers();
		await expect(page.evaluate("1", 60_000)).rejects.toThrow(/connection closed/);
		expect(socket.sent).toEqual([]);
	});

	it("skips a frame that is not JSON, and still takes the answer after it", async () => {
		const { page, socket } = await openFakePage();
		const value = page.evaluate("1", 1000);
		expect(() => socket.deliver("not json")).not.toThrow();
		socket.answer({ id: 1, result: { result: { value: 1 } } });
		expect(await value).toBe(1);
	});
});

describe("the page a DevTools endpoint lists", () => {
	it("is the first target of type page, by its WebSocket address", () => {
		const targets = [
			{ type: "service_worker", webSocketDebuggerUrl: "ws://worker" },
			{ type: "page", webSocketDebuggerUrl: "ws://page" },
		];
		expect(pageSocketUrl(targets)).toBe("ws://page");
	});

	it("is refused when the endpoint lists no page, naming only the targets' types: their addresses may hold an app key", () => {
		const targets = [{ type: "other" }, { type: "page", url: "https://www.example.com/authorize?client_id=the-key" }];
		expect(() => pageSocketUrl(targets)).toThrow("no page to debug among: other, page without a socket");
		expect(() => pageSocketUrl(targets)).not.toThrow(/the-key/);
		expect(() => pageSocketUrl({ message: "nope" })).toThrow("no page to debug: the endpoint listed no targets");
	});
});

describe("the value of a Runtime.evaluate answer", () => {
	it("is the result's value", () => {
		expect(evaluationValue({ id: 1, result: { result: { type: "string", value: "x" } } })).toBe("x");
		expect(evaluationValue({ id: 1, result: { result: { type: "undefined" } } })).toBeUndefined();
	});

	it("throws the exception the expression raised, by its description", () => {
		const raised = { id: 1, result: { result: {}, exceptionDetails: { text: "Uncaught", exception: { description: "SyntaxError: bad" } } } };
		expect(() => evaluationValue(raised)).toThrow(/in the page: SyntaxError: bad/);
	});

	it("throws the exception's text when it has no description", () => {
		expect(() => evaluationValue({ id: 1, result: { exceptionDetails: { text: "Uncaught" } } })).toThrow(/in the page: Uncaught/);
	});

	it("throws the protocol's error", () => {
		expect(() => evaluationValue({ id: 1, error: { code: -32000, message: "Cannot find context" } })).toThrow(/DevTools: Cannot find context/);
	});

	it("refuses what is no answer", () => {
		expect(() => evaluationValue({ id: 1 })).toThrow(/not a Runtime\.evaluate answer/);
	});
});
