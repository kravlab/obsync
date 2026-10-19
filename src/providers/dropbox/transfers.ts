/**
 * Moving file content to and from Dropbox under the Per-request limit
 * (spec, "Dropbox provider", transfers): no request or response body is
 * larger than the limit, while the Provider still takes and returns whole
 * buffers.
 *
 * - An upload up to the limit is one `files/upload`; a larger one is a
 *   sequential upload session (`upload_session/start`, `append_v2`,
 *   `finish`), which needs no 4 MiB multiples.
 * - A download first reads the file's `rev` and `size` (`get_metadata`),
 *   then reads `rev:<rev>`, so parts never mix two versions: in one
 *   `files/download` up to the limit, in `Range` parts above it. An empty
 *   file gets no `Range`, whose answer for it Dropbox does not document.
 */
import type { RequestLimit } from "../../engine/request-limit";
import { ProviderError, type RemoteContent } from "../../engine/provider";
import type { DropboxClient, RouteResult } from "./client";
import { WRITE_RETRY_AFTER_MS, writeFailure, type Tagged } from "./errors";
import type { Wait } from "./options";
import { fileRevision, lookupFailure, routeFailure, summary, type FileRevision, type Metadata } from "./routes";

/** How one Provider moves content: the limit as it was when it was opened, and how it pauses. */
export interface TransferRules {
	readonly limit: RequestLimit;
	readonly wait: Wait;
}

/** The commit of an upload: `files/upload`'s argument, and a session's `commit`. */
export interface CommitInfo {
	readonly path: string;
	readonly mode: unknown;
	readonly autorename: boolean;
	readonly strict_conflict: boolean;
}

/**
 * How often an upload session request is tried again in a row: after a
 * `transient` or `throttled` failure, or a resume that did not get a
 * request through, before the write fails.
 */
const SESSION_RETRIES = 3;

/** The pause before a session request that failed `transient` is retried, in ms. */
const TRANSIENT_RETRY_MS = 1000;

/**
 * Uploads `data` as `commit` says, in requests no larger than the limit,
 * and returns the new file's revision and size. An upload session is
 * finished here (spec, "Provider contract", errors): a request that failed
 * `transient` or `throttled`, or a `finish` Dropbox asks to slow down, is
 * retried after a pause, and a request that arrived although its answer
 * did not (`incorrect_offset`) is continued from where Dropbox says. Each
 * is tried again at most `SESSION_RETRIES` times in a row.
 */
export async function uploadFile(
	client: DropboxClient,
	commit: CommitInfo,
	data: ArrayBuffer,
	{ limit, wait }: TransferRules,
): Promise<FileRevision> {
	const chunk = limit.bytes;
	if (data.byteLength <= chunk) {
		const result = await client.upload("files/upload", commit, data);
		if (!result.ok) throw transferFailure("upload", result.error);
		return fileRevision(result.value as Metadata, "upload");
	}
	const started = await withSessionRetries(
		() => client.upload("files/upload_session/start", { close: false }, data.slice(0, chunk)),
		wait,
	);
	if (!started.ok) throw transferFailure("upload_session/start", started.error);
	const sessionId = (started.value as { session_id: string }).session_id;
	let offset = chunk;
	let triedAgain = 0;
	for (;;) {
		const cursor = { session_id: sessionId, offset };
		const last = data.byteLength - offset <= chunk;
		const route = last ? "upload_session/finish" : "upload_session/append_v2";
		const result = await withSessionRetries(
			() =>
				last
					? client.upload(`files/${route}`, { cursor, commit }, data.slice(offset))
					: client.upload(`files/${route}`, { cursor }, data.slice(offset, offset + chunk)),
			wait,
		);
		if (result.ok) {
			if (last) return fileRevision(result.value as Metadata, route);
			offset += chunk;
			triedAgain = 0;
			continue;
		}
		const failure = transferFailure(route, result.error);
		const correctOffset = correctOffsetOf(result.error, data.byteLength);
		// Only finish commits, so only finish is told to slow down.
		const slowDown = last && failure.failure.category === "throttled" ? failure.failure.retryAfterMs : undefined;
		if (correctOffset === undefined && slowDown === undefined) throw failure;
		if (triedAgain >= SESSION_RETRIES) {
			throw slowDown === undefined
				? new ProviderError({ category: "transient" }, `${route}: no progress after resuming: ${summary(result.error)}`)
				: failure;
		}
		triedAgain += 1;
		if (correctOffset !== undefined) offset = correctOffset;
		else if (slowDown !== undefined) await wait(slowDown);
	}
}

/**
 * Sends one session request, retried up to `SESSION_RETRIES` times after
 * a `transient` or `throttled` failure. Route errors come back to the
 * caller.
 */
async function withSessionRetries(send: () => Promise<RouteResult>, wait: Wait): Promise<RouteResult> {
	for (let retry = 0; ; retry += 1) {
		try {
			return await send();
		} catch (error) {
			const pause = retryPause(error);
			if (pause === undefined || retry >= SESSION_RETRIES) throw error;
			await wait(pause);
		}
	}
}

/** How long to pause before retrying after `error`, or undefined if it is not retried. */
function retryPause(error: unknown): number | undefined {
	if (!(error instanceof ProviderError)) return undefined;
	if (error.failure.category === "throttled") return error.failure.retryAfterMs;
	return error.failure.category === "transient" ? TRANSIENT_RETRY_MS : undefined;
}

/**
 * The UploadSessionLookupError of a session route error: `append_v2`
 * answers it as it is, `finish` nests it under `lookup_failed`.
 */
function sessionLookupOf(error: Tagged): Tagged {
	return error[".tag"] === "lookup_failed" ? ((error.lookup_failed as Tagged | undefined) ?? error) : error;
}

/**
 * The offset Dropbox holds the session's data up to, from an
 * `incorrect_offset` error; undefined for any other error, or an offset
 * outside the file.
 */
function correctOffsetOf(error: Tagged, size: number): number | undefined {
	const lookup = sessionLookupOf(error);
	if (lookup[".tag"] !== "incorrect_offset") return undefined;
	const offset = lookup.correct_offset;
	return typeof offset === "number" && Number.isInteger(offset) && offset >= 0 && offset <= size ? offset : undefined;
}

/**
 * The failure for a route error of `files/upload` or an upload session
 * route. A `path` WriteError maps as `writeFailure` says: `files/upload`
 * carries it as `reason`, `finish` as `path`. An expired session
 * (`not_found`) is `transient`, so a later write starts a new one; a
 * request or session too large is `tooLarge`.
 */
function transferFailure(route: string, error: Tagged): ProviderError {
	const reason = sessionLookupOf(error);
	switch (reason[".tag"]) {
		case "path":
			return new ProviderError(writeFailure((reason.reason ?? reason.path) as Tagged | undefined), summary(error));
		case "not_found":
			return new ProviderError({ category: "transient" }, summary(error));
		case "too_large":
		case "payload_too_large":
			return new ProviderError({ category: "tooLarge" }, summary(error));
		case "too_many_write_operations":
			return new ProviderError({ category: "throttled", retryAfterMs: WRITE_RETRY_AFTER_MS }, summary(error));
		default:
			return routeFailure(route, error);
	}
}

/**
 * Downloads the file at the App-Folder `path` in responses no larger than
 * the limit, with the revision it read. A path holding no file is `notFound`, a folder `permanent`.
 */
export async function downloadFile(
	client: DropboxClient,
	path: string,
	{ limit }: TransferRules,
): Promise<RemoteContent> {
	const found = await client.rpc("files/get_metadata", { path });
	if (!found.ok) throw lookupFailure("get_metadata", found.error);
	const metadata = found.value as Metadata;
	if (metadata[".tag"] !== "file") {
		throw new ProviderError({ category: "permanent" }, `get_metadata: not a file: ${path}`);
	}
	const { rev, size } = fileRevision(metadata, "get_metadata");
	const revision = { path: `rev:${rev}` };
	const part = limit.bytes;
	if (size <= part) {
		const result = await client.download(revision);
		if (!result.ok) throw lookupFailure("download", result.error);
		return { data: result.data, revision: rev };
	}
	const whole = new Uint8Array(size);
	for (let start = 0; start < size; start += part) {
		const end = Math.min(start + part, size) - 1;
		const result = await client.download(revision, { start, end });
		if (!result.ok) throw lookupFailure("download", result.error);
		if (result.data.byteLength !== end - start + 1) {
			throw new ProviderError(
				{ category: "permanent" },
				`download: ${result.data.byteLength} bytes for the range ${start}-${end} of ${path}`,
			);
		}
		whole.set(new Uint8Array(result.data), start);
	}
	return { data: whole.buffer, revision: rev };
}
