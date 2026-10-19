import type { Clock } from "../../engine/ports";
import type { HttpClient } from "./http";

/** What the Dropbox connect step and connector are built from. */
export interface DropboxOptions {
	/** The plugin's Dropbox app key; public, with no secret (PKCE). */
	readonly appKey: string;
	/** Obsidian's `requestUrl`, or a fake in tests. */
	readonly http: HttpClient;
	/** This device's time, which access tokens expire by. */
	readonly clock: Clock;
}
