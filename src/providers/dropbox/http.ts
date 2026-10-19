/**
 * The HTTP function the Dropbox provider sends every request through: the
 * subset of Obsidian's `requestUrl` it uses, so the shell passes
 * `requestUrl` itself and tests pass a fake service. The provider never
 * imports Obsidian.
 */

/** One HTTP request, as `requestUrl` takes it. */
export interface HttpRequest {
	readonly url: string;
	readonly method: "POST";
	readonly contentType?: string;
	readonly body?: string | ArrayBuffer;
	readonly headers?: Readonly<Record<string, string>>;
	/** Always false: every status comes back as a response to map. */
	readonly throw: false;
}

/** One HTTP response, as `requestUrl` returns it. */
export interface HttpResponse {
	readonly status: number;
	/** Header names may come in any case. */
	readonly headers: Readonly<Record<string, string>>;
	readonly text: string;
	readonly arrayBuffer: ArrayBuffer;
}

/**
 * Sends one request. It rejects only when no response arrived at all
 * (offline, DNS, TLS); HTTP error statuses resolve.
 */
export type HttpClient = (request: HttpRequest) => Promise<HttpResponse>;
