import { createContext, runInContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { providerSecretId } from "../../../src/engine/ports";
import { DEFAULT_REQUEST_LIMIT } from "../../../src/engine/request-limit";
import { DROPBOX_PROVIDER_ID } from "../../../src/providers/dropbox/provider";
import { dropboxAppKey, dropboxHelpers, PLUGIN_SECRET_HELPER, SHA256_HELPER } from "./dropbox-page";

/** A request as the helpers hand it to Obsidian's requestUrl. */
interface Request {
	readonly url: string;
	readonly method: string;
	readonly contentType?: string;
	readonly headers?: Record<string, string>;
	readonly body?: string;
	readonly throw: boolean;
}

/** An answer of the fake requestUrl. */
interface Answer {
	readonly status: number;
	readonly json?: unknown;
	readonly arrayBuffer?: ArrayBuffer;
}

interface Helpers {
	pluginSecret(): string | null;
	dropboxAccess(secret: string): Promise<{ status: number; token?: string; error?: unknown }>;
	dropboxCall(token: string, route: string, args: unknown): Promise<{ status: number; json?: unknown }>;
	dropboxDownload(token: string, path: string, size: number): Promise<ArrayBuffer>;
	sha256(bytes: ArrayBuffer): Promise<string>;
	askDropbox<T>(ask: () => Promise<Asked<T> | null>, timeoutMs: number, what: string, everyMs?: number, throttledMs?: number): Promise<T>;
}

/** What one ask of `askDropbox` answers. */
interface Asked<T> {
	readonly status: number;
	readonly done: boolean;
	readonly value?: T;
}

/** The helpers for app key "the-key", run in Node over a fake `app` and `requestUrl` that records every request. */
function helpersOver(answer: (request: Request) => Answer, secrets: Record<string, string> = {}): { helpers: Helpers; sent: Request[] } {
	const sent: Request[] = [];
	const app = { secretStorage: { getSecret: (id: string) => secrets[id] ?? null } };
	const requestUrl = (request: Request) => {
		sent.push(request);
		return Promise.resolve(answer(request));
	};
	// The page's globals the helpers use; the rest are the language's own.
	const page = createContext({ app, requestUrl, crypto, URLSearchParams, setTimeout });
	const helpers = runInContext(`(() => {${dropboxHelpers("the-key")}\nreturn { pluginSecret, dropboxAccess, dropboxCall, dropboxDownload, sha256, askDropbox };})()`, page) as Helpers;
	return { helpers, sent };
}

describe("the plugin's login, read in the page", () => {
	it("is the secret the plugin stores for Dropbox", () => {
		const { helpers } = helpersOver(() => ({ status: 500 }), { [providerSecretId(DROPBOX_PROVIDER_ID)]: "refresh" });
		expect(helpers.pluginSecret()).toBe("refresh");
	});

	it("is null while the plugin is not connected", () => {
		expect(helpersOver(() => ({ status: 500 })).helpers.pluginSecret()).toBeNull();
	});

	it("is null once Disconnect removed it, which the plugin stores as the empty string", () => {
		const { helpers } = helpersOver(() => ({ status: 500 }), { [providerSecretId(DROPBOX_PROVIDER_ID)]: "" });
		expect(helpers.pluginSecret()).toBeNull();
	});
});

describe("an access token from the plugin's login", () => {
	it("is asked for with the refresh token and the app key, as a form", async () => {
		const { helpers, sent } = helpersOver(() => ({ status: 200, json: { access_token: "access" } }));
		expect(await helpers.dropboxAccess("refresh")).toEqual({ status: 200, token: "access" });
		expect(sent).toHaveLength(1);
		expect(sent[0]).toMatchObject({ url: "https://api.dropboxapi.com/oauth2/token", method: "POST", contentType: "application/x-www-form-urlencoded", throw: false });
		expect(Object.fromEntries(new URLSearchParams(sent[0]?.body))).toEqual({ grant_type: "refresh_token", refresh_token: "refresh", client_id: "the-key" });
	});

	it("is refused with Dropbox's status and error, without a token", async () => {
		const { helpers } = helpersOver(() => ({ status: 400, json: { error: "invalid_grant" } }));
		expect(await helpers.dropboxAccess("revoked")).toEqual({ status: 400, error: "invalid_grant" });
	});
});

describe("a Dropbox RPC call", () => {
	it("posts the route's arguments as JSON with the token, answering the status and JSON", async () => {
		const { helpers, sent } = helpersOver(() => ({ status: 200, json: { ok: true } }));
		expect(await helpers.dropboxCall("access", "files/delete_v2", { path: "/run" })).toEqual({ status: 200, json: { ok: true } });
		expect(sent[0]).toMatchObject({
			url: "https://api.dropboxapi.com/2/files/delete_v2",
			method: "POST",
			contentType: "application/json",
			headers: { Authorization: "Bearer access" },
			body: JSON.stringify({ path: "/run" }),
			throw: false,
		});
	});

	it("answers the route's error with a 409, so a caller tells a missing path from another refusal", async () => {
		const error = { error_summary: "path_lookup/not_found/", error: { ".tag": "path_lookup", path_lookup: { ".tag": "not_found" } } };
		const { helpers } = helpersOver(() => ({ status: 409, json: error }));
		expect(await helpers.dropboxCall("access", "files/delete_v2", { path: "/gone" })).toEqual({ status: 409, json: error });
	});

	it.each([401, 500])("answers only the status for any other refusal: HTTP %i", async (status) => {
		const { helpers } = helpersOver(() => ({ status, json: { error: "refused" } }));
		expect(await helpers.dropboxCall("access", "files/delete_v2", { path: "/run" })).toEqual({ status, json: undefined });
	});
});

describe("downloading a file back", () => {
	const part = DEFAULT_REQUEST_LIMIT.bytes;
	/** A fake file whose byte at `index` is `index % 251`, answering the Range a request asks for. */
	const file = (size: number) => (request: Request): Answer => {
		const [start, end] = (/^bytes=(\d+)-(\d+)$/.exec(request.headers?.Range ?? "") ?? []).slice(1).map(Number);
		if (start === undefined || end === undefined) return { status: 200, arrayBuffer: new ArrayBuffer(size) };
		const bytes = new Uint8Array(end - start + 1).map((_, index) => (start + index) % 251);
		return { status: 206, arrayBuffer: bytes.buffer };
	};

	it("reads it in Range parts no larger than the plugin's Per-request limit, and puts them together", async () => {
		const size = 2 * part + 5;
		const { helpers, sent } = helpersOver(file(size));
		const bytes = new Uint8Array(await helpers.dropboxDownload("access", "rev:abc", size));
		expect(sent.map((request) => request.headers?.Range)).toEqual([`bytes=0-${part - 1}`, `bytes=${part}-${2 * part - 1}`, `bytes=${2 * part}-${2 * part + 4}`]);
		expect(sent[0]).toMatchObject({
			url: "https://content.dropboxapi.com/2/files/download",
			method: "POST",
			headers: { Authorization: "Bearer access", "Dropbox-API-Arg": JSON.stringify({ path: "rev:abc" }) },
		});
		expect(bytes.length).toBe(size);
		expect([bytes[0], bytes[part - 1], bytes[part], bytes[size - 1]]).toEqual([0, (part - 1) % 251, part % 251, (size - 1) % 251]);
	});

	it("fails on a part answered with another status than 206", async () => {
		const { helpers } = helpersOver(() => ({ status: 200, arrayBuffer: new ArrayBuffer(10) }));
		await expect(helpers.dropboxDownload("access", "rev:abc", 10)).rejects.toThrow("downloading rev:abc from 0: HTTP 200");
	});

	it("fails on a part of another length than asked", async () => {
		const { helpers } = helpersOver(() => ({ status: 206, arrayBuffer: new ArrayBuffer(9) }));
		await expect(helpers.dropboxDownload("access", "rev:abc", 10)).rejects.toThrow("downloading rev:abc from 0: 9 bytes");
	});
});

describe("the SHA-256 of bytes", () => {
	it("is the hex digest", async () => {
		const { helpers } = helpersOver(() => ({ status: 500 }));
		expect(await helpers.sha256(new TextEncoder().encode("abc").buffer)).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
	});
});

describe("the helpers a page needs without the app key", () => {
	it("read the plugin's login and hash bytes alone, holding no app key", async () => {
		const page = createContext({ app: { secretStorage: { getSecret: () => "refresh" } }, crypto });
		const run = runInContext(`(() => {${PLUGIN_SECRET_HELPER}\n${SHA256_HELPER}\nreturn { pluginSecret, sha256 };})()`, page) as Pick<Helpers, "pluginSecret" | "sha256">;
		expect(run.pluginSecret()).toBe("refresh");
		expect(await run.sha256(new TextEncoder().encode("abc").buffer)).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
		expect(`${PLUGIN_SECRET_HELPER}${SHA256_HELPER}`).not.toContain("the-key");
	});
});

describe("asking Dropbox until it holds what a check waits for", () => {
	const quick = { timeoutMs: 200, everyMs: 1, throttledMs: 1 };
	const ask = (helpers: Helpers, answers: readonly (Asked<string> | Error | null)[]) => {
		let index = 0;
		const asked = vi.fn(() => {
			const answer = answers[Math.min(index++, answers.length - 1)];
			return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer ?? null);
		});
		return { asked, result: helpers.askDropbox(asked, quick.timeoutMs, "the file", quick.everyMs, quick.throttledMs) };
	};

	it("resolves with the value of the first answer that is done", async () => {
		const { helpers } = helpersOver(() => ({ status: 500 }));
		const { asked, result } = ask(helpers, [{ status: 200, done: false }, { status: 200, done: true, value: "there" }]);
		expect(await result).toBe("there");
		expect(asked).toHaveBeenCalledTimes(2);
	});

	it("asks again after a failed ask, a throttled one and one not asked", async () => {
		const { helpers } = helpersOver(() => ({ status: 500 }));
		const { asked, result } = ask(helpers, [new Error("offline"), { status: 429, done: false }, null, { status: 200, done: true, value: "there" }]);
		expect(await result).toBe("there");
		expect(asked).toHaveBeenCalledTimes(4);
	});

	it("waits longer after Dropbox answered 429", async () => {
		const { helpers } = helpersOver(() => ({ status: 500 }));
		const started = Date.now();
		let calls = 0;
		const throttledOnce = () => Promise.resolve(calls++ === 0 ? { status: 429, done: false } : { status: 200, done: true, value: "there" });
		expect(await helpers.askDropbox(throttledOnce, 1000, "the file", 1, 60)).toBe("there");
		expect(Date.now() - started).toBeGreaterThanOrEqual(55);
	});

	it("fails naming what it waited for once the time is up", async () => {
		const { helpers } = helpersOver(() => ({ status: 500 }));
		await expect(ask(helpers, [{ status: 200, done: false }]).result).rejects.toThrow("timed out after 200 ms waiting for the file on Dropbox");
	});
});

describe("the app key the build takes", () => {
	afterEach(() => vi.unstubAllEnvs());

	it("is read from the environment", () => {
		vi.stubEnv("SEAMSYNC_DROPBOX_APP_KEY", "the-key");
		expect(dropboxAppKey()).toBe("the-key");
	});

	it("is refused when the environment holds none", () => {
		vi.stubEnv("SEAMSYNC_DROPBOX_APP_KEY", "");
		expect(() => dropboxAppKey()).toThrow("Set SEAMSYNC_DROPBOX_APP_KEY, in the environment or in .env");
	});
});
