// A page of an Android WebView, driven over the Chrome DevTools protocol:
// the endpoint `adb forward` makes of the WebView's
// `webview_devtools_remote_<pid>` socket lists the page at `/json`, and its
// WebSocket takes `Runtime.evaluate`. Node's own `fetch` and `WebSocket`, no
// dependency (spec, "Proposed choices").

/** How long opening a page may take: the endpoint's list and the WebSocket's handshake, each. */
const OPEN_TIMEOUT_MS = 10_000;

/**
 * The WebSocket address of the first page `targets`, the endpoint's `/json`
 * list, holds. A refusal names the targets' types only: a target's address
 * may hold the app key (Dropbox's authorize page).
 */
export function pageSocketUrl(targets: unknown): string {
	if (!Array.isArray(targets)) throw new Error("no page to debug: the endpoint listed no targets");
	const listed: string[] = [];
	for (const target of targets as unknown[]) {
		if (!isRecord(target)) continue;
		if (target.type === "page" && typeof target.webSocketDebuggerUrl === "string") return target.webSocketDebuggerUrl;
		listed.push(target.type === "page" ? "page without a socket" : String(target.type));
	}
	throw new Error(`no page to debug among: ${listed.join(", ")}`);
}

/**
 * The value a `Runtime.evaluate` answer `message` returns by value. Throws
 * the exception the expression raised as `in the page: …`, and the
 * protocol's own error as `DevTools: …`.
 */
export function evaluationValue(message: unknown): unknown {
	if (!isRecord(message)) throw new Error(`not a Runtime.evaluate answer: ${JSON.stringify(message)}`);
	if (isRecord(message.error)) throw new Error(`DevTools: ${String(message.error.message)}`);
	const result = message.result;
	if (!isRecord(result)) throw new Error(`not a Runtime.evaluate answer: ${JSON.stringify(message)}`);
	const details = result.exceptionDetails;
	if (isRecord(details)) {
		const description = isRecord(details.exception) ? details.exception.description : undefined;
		throw new Error(`in the page: ${String(typeof description === "string" ? description : details.text)}`);
	}
	if (!isRecord(result.result)) throw new Error(`not a Runtime.evaluate answer: ${JSON.stringify(message)}`);
	return result.result.value;
}

/** A WebView page open over DevTools. */
export class DevToolsPage {
	private nextId = 0;
	private readonly pending = new Map<number, { resolve: (message: unknown) => void; reject: (error: Error) => void }>();
	/** Set once the connection is closed, from either end: an evaluation then fails at once, as a closed socket drops what it is sent. */
	private closed = false;

	/** Takes the open `socket`'s answers and its close; see open(). */
	private constructor(private readonly socket: WebSocket) {
		socket.addEventListener("message", (event) => {
			let message: unknown;
			try {
				message = JSON.parse(String(event.data));
			} catch {
				// Not a protocol message, so the answer to no evaluation.
				return;
			}
			if (!isRecord(message) || typeof message.id !== "number") return;
			this.pending.get(message.id)?.resolve(message);
			this.pending.delete(message.id);
		});
		socket.addEventListener("close", () => this.closeDown());
	}

	/**
	 * Opens the page the DevTools endpoint on local `port` lists; fails if
	 * the endpoint does not list it, or the connection does not open, within
	 * `timeoutMs` each.
	 */
	static async open(port: number, timeoutMs = OPEN_TIMEOUT_MS): Promise<DevToolsPage> {
		let response: Response;
		try {
			response = await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(timeoutMs) });
		} catch (error) {
			if (error instanceof DOMException && error.name === "TimeoutError")
				throw new Error(`DevTools: no answer from port ${port} within ${timeoutMs} ms`);
			throw error;
		}
		if (!response.ok) throw new Error(`DevTools: /json answered HTTP ${response.status}`);
		const socket = new WebSocket(pageSocketUrl(await response.json()));
		try {
			await new Promise<void>((resolve, reject) => {
				const timer = setTimeout(
					() => reject(new Error(`DevTools: the page's connection did not open within ${timeoutMs} ms`)),
					timeoutMs,
				);
				socket.addEventListener("open", () => (clearTimeout(timer), resolve()), { once: true });
				socket.addEventListener("error", () => (clearTimeout(timer), reject(new Error("DevTools: the page's connection failed"))), {
					once: true,
				});
			});
		} catch (error) {
			socket.close();
			throw error;
		}
		return new DevToolsPage(socket);
	}

	/**
	 * The value of `expression` in the page, awaited if it is a promise and
	 * returned by value, as from a user's gesture (the clipboard and
	 * `window.open` ask for one). Fails after `timeoutMs`.
	 */
	evaluate(expression: string, timeoutMs: number): Promise<unknown> {
		if (this.closed) return Promise.reject(new Error("DevTools: the page's connection closed"));
		const id = ++this.nextId;
		return new Promise<unknown>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`DevTools: no answer within ${timeoutMs} ms`));
			}, timeoutMs);
			this.pending.set(id, {
				resolve: (message) => {
					clearTimeout(timer);
					try {
						resolve(evaluationValue(message));
					} catch (error) {
						reject(error instanceof Error ? error : new Error(String(error)));
					}
				},
				reject: (error) => {
					clearTimeout(timer);
					reject(error);
				},
			});
			this.socket.send(
				JSON.stringify({
					id,
					method: "Runtime.evaluate",
					params: { expression, awaitPromise: true, returnByValue: true, userGesture: true },
				}),
			);
		});
	}

	/** Whether the connection is closed, from either end: the page must then be opened again to be evaluated in. */
	isClosed(): boolean {
		return this.closed;
	}

	/** Closes the connection; evaluations still waiting fail. */
	close(): void {
		this.socket.close();
		this.closeDown();
	}

	/** Marks the connection closed and fails every evaluation still waiting. */
	private closeDown(): void {
		this.closed = true;
		const error = new Error("DevTools: the page's connection closed");
		for (const { reject } of this.pending.values()) reject(error);
		this.pending.clear();
	}
}

/** Whether `value` is a plain object, whose fields can be read. */
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
