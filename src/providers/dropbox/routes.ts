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

/** What the plugin needs of a file's metadata: its revision and size. */
export interface FileRevision {
	readonly rev: string;
	readonly size: number;
}

/**
 * The revision and size of a file's metadata from `route`. A file
 * without them is a response this provider cannot trust: `permanent`.
 */
export function fileRevision(file: Metadata, route: string): FileRevision {
	if (file.rev === undefined || file.size === undefined) {
		throw new ProviderError({ category: "permanent" }, `${route}: a file without rev or size: ${file.path_lower}`);
	}
	return { rev: file.rev, size: file.size };
}

/** A `list_folder` page. */
interface ListPage {
	readonly entries: readonly Metadata[];
	readonly cursor: string;
	readonly has_more: boolean;
}

/** Every entry a `list_folder` or `list_folder/continue` run yielded, and the cursor after the last page. */
export interface FolderBatch {
	/** The entries of every page, in Dropbox's order. */
	readonly entries: readonly Metadata[];
	/** The cursor after the last page, where `list_folder/continue` picks up. */
	readonly cursor: string;
}

/**
 * Every entry `list_folder` gives for `path` ("" for the App Folder),
 * following `has_more`, and the cursor after the last page. A missing
 * folder is `notFound`; a cursor Dropbox reset while paging (`reset`) is
 * `cursorLost`.
 */
export async function listFolder(client: DropboxClient, path: string, recursive: boolean): Promise<FolderBatch> {
	const first = listPage(await client.rpc("files/list_folder", { path, recursive }), "list_folder");
	return followPages(client, first);
}

/**
 * Every entry `list_folder/continue` gives from `cursor`, following
 * `has_more`, and the cursor after the last page. A cursor Dropbox no
 * longer knows (`reset`) is `cursorLost`.
 */
export async function listFolderContinue(client: DropboxClient, cursor: string): Promise<FolderBatch> {
	const first = listPage(await client.rpc("files/list_folder/continue", { cursor }), "list_folder/continue");
	return followPages(client, first);
}

/** Collects `first` and every page following its `has_more`. */
async function followPages(client: DropboxClient, first: ListPage): Promise<FolderBatch> {
	const entries: Metadata[] = [...first.entries];
	let page = first;
	while (page.has_more) {
		page = listPage(await client.rpc("files/list_folder/continue", { cursor: page.cursor }), "list_folder/continue");
		entries.push(...page.entries);
	}
	return { entries, cursor: page.cursor };
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
