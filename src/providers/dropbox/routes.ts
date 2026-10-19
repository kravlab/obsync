/**
 * The Dropbox route shapes and route-error handling shared by the connect
 * step and the Provider (Dropbox API spec, `files.stone`): file and folder
 * metadata, paging through `list_folder`, and the categories of the route
 * errors both read.
 */
import { ProviderError } from "../../engine/provider";
import type { DropboxClient, RouteResult } from "./client";
import type { Tagged } from "./errors";

/** Dropbox file, folder or deleted-entry metadata, as far as the plugin reads it. */
export interface Metadata {
	readonly ".tag": string;
	/** The last path component, with its correct case. */
	readonly name: string;
	readonly path_lower: string;
	/**
	 * The path for display; Dropbox guarantees the case of its last
	 * component only.
	 */
	readonly path_display: string;
	/** Files only. */
	readonly rev?: string;
	/** Files only, in bytes. */
	readonly size?: number;
}

/** A `list_folder` page. */
interface ListPage {
	readonly entries: readonly Metadata[];
	readonly cursor: string;
	readonly has_more: boolean;
}

/**
 * Every entry `list_folder` gives for `path` ("" for the App Folder),
 * following `has_more`. A missing folder is `notFound`; a cursor Dropbox
 * reset while paging (`reset`) is `cursorLost`.
 */
export async function listFolder(client: DropboxClient, path: string, recursive: boolean): Promise<Metadata[]> {
	const entries: Metadata[] = [];
	let page = listPage(await client.rpc("files/list_folder", { path, recursive }), "list_folder");
	entries.push(...page.entries);
	while (page.has_more) {
		page = listPage(await client.rpc("files/list_folder/continue", { cursor: page.cursor }), "list_folder/continue");
		entries.push(...page.entries);
	}
	return entries;
}

/** A `list_folder` page, or the route's error thrown as a ProviderError. */
function listPage(result: RouteResult, route: string): ListPage {
	if (result.ok) return result.value as ListPage;
	if (result.error[".tag"] === "reset") throw new ProviderError({ category: "cursorLost" }, summary(result.error));
	throw lookupFailure(route, result.error);
}

/** The value of a route that has no route error worth telling apart. */
export function expectValue(result: RouteResult, route: string): unknown {
	if (!result.ok) throw routeFailure(route, result.error);
	return result.value;
}

/** The tag of a LookupError under a `path` error, e.g. `not_found`. */
export function lookupTag(error: Tagged): string | undefined {
	return error[".tag"] === "path" ? (error.path as Tagged | undefined)?.[".tag"] : undefined;
}

/** The WriteError under `create_folder_v2`'s `path` error. */
export function writeErrorOf(error: Tagged): Tagged | undefined {
	return error[".tag"] === "path" ? (error.path as Tagged | undefined) : undefined;
}

/** The failure for a route error that may be a LookupError: `notFound` for a missing path, else permanent. */
export function lookupFailure(route: string, error: Tagged): ProviderError {
	if (lookupTag(error) === "not_found") return new ProviderError({ category: "notFound" }, summary(error));
	return routeFailure(route, error);
}

/** A route error the caller has no category for. */
export function routeFailure(route: string, error: Tagged): ProviderError {
	return new ProviderError({ category: "permanent" }, `${route}: ${summary(error)}`);
}

/** The route error as diagnostic text. */
export function summary(error: Tagged): string {
	return JSON.stringify(error);
}
