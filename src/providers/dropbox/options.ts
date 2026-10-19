import type { Clock } from "../../engine/ports";
import type { RequestLimit } from "../../engine/request-limit";
import type { HttpClient } from "./http";

/** What the Dropbox connect step and connector are built from. */
export interface DropboxOptions {
	/** The plugin's Dropbox app key; public, with no secret (PKCE). */
	readonly appKey: string;
	/** Obsidian's `requestUrl`, or a fake in tests. */
	readonly http: HttpClient;
	/** This device's time, which access tokens expire by. */
	readonly clock: Clock;
	/** How file content moves. */
	readonly transfers: DropboxTransfers;
}

/** Resolves after `ms`: a pause, such as before a session request is retried. */
export type Wait = (ms: number) => Promise<void>;

/** How the Dropbox Provider moves file content (spec, "Dropbox provider", transfers). */
export interface DropboxTransfers {
	/**
	 * This device's Per-request limit, read each time a Provider is opened:
	 * no request or response body is larger.
	 */
	readonly requestLimit: () => RequestLimit;
	/** The pause before a session request is retried. */
	readonly wait: Wait;
}
