/**
 * The Remote's name policy (spec, "Synced file scope"; Provider contract,
 * "Name rules"): how a vault path becomes the Remote path the provider
 * stores, under the provider's declared `NameRules`.
 *
 * - "Skip and report": a vault path is stored as it is, or not at all
 *   when the rules refuse it.
 * - "Encode reversibly": each character the provider declares forbidden
 *   (anywhere, or at the end of a segment) is replaced by a fixed
 *   substitute, the same table for every provider (rclone's):
 *   - control characters U+0000–U+001F by the control pictures
 *     U+2400–U+241F, DEL by U+2421, a space by U+2420;
 *   - printable ASCII punctuation by its fullwidth form, U+FF01–U+FF5E.
 *
 *   Nothing else changes. To stay strictly reversible, a vault name that
 *   already holds a substitute this provider's encoding produces is
 *   refused instead of encoded, since its Remote name could not be told
 *   apart from an encoded one. Reserved names and over-long segments or
 *   paths cannot be fixed by substituting characters and are refused in
 *   both modes.
 *
 * A refused path is left out of sync and reported (sync-listing.ts).
 * `namedProvider` applies the policy to every provider call, so the rest
 * of the engine works in vault paths only.
 */
import type { VaultPath } from "./local-vault";
import { pathKey } from "./paths";
import {
	ProviderError,
	type Change,
	type Listing,
	type NameRules,
	type Provider,
	type RemoteEntry,
	type RemotePath,
} from "./provider";
import type { RemoteSettings } from "./remote-metadata";

/** What happens to names the provider cannot store. */
export type NamePolicy = RemoteSettings["namePolicy"];

/** How vault paths and Remote paths map to each other under one name policy. */
export interface PathCodec {
	/** The Remote path the vault path `path` is stored under, or null when the provider cannot store it. */
	toRemote(path: VaultPath): RemotePath | null;
	/** The vault path of the Remote path `path`. */
	toVault(path: RemotePath): VaultPath;
}

/** The substitute the encoding uses for `character`, or null when the table has none. */
function substituteOf(character: string): string | null {
	const code = character.codePointAt(0) ?? -1;
	if (character.length !== 1) return null;
	if (code < 0x20) return String.fromCharCode(0x2400 + code);
	if (code === 0x20) return "␠";
	if (code === 0x7f) return "␡";
	if (code < 0x7f && !/[0-9A-Za-z]/.test(character)) return String.fromCharCode(code + 0xfee0);
	return null;
}

/** The codec for the name rules `rules` under the name policy `policy`. */
export function pathCodec(rules: NameRules, policy: NamePolicy): PathCodec {
	const reserved = new Set(rules.reservedNames.map((name) => pathKey(name, rules.caseInsensitive)));
	/** Substitute to forbidden character, for anywhere in a segment and for its end. */
	const anywhere = substitutes(rules.forbiddenCharacters);
	const atEnd = substitutes(rules.forbiddenAtEnd);
	const encoding = policy === "encodeReversibly";

	/** Whether the provider stores `segment`, a name already encoded, as it is. */
	function storable(segment: string): boolean {
		if (segment.length === 0 || reserved.has(pathKey(segment, rules.caseInsensitive))) return false;
		if (rules.maxSegmentLength !== undefined && segment.length > rules.maxSegmentLength) return false;
		if (rules.forbiddenCharacters.some((character) => segment.includes(character))) return false;
		return !rules.forbiddenAtEnd.some((character) => segment.endsWith(character));
	}

	/** `segment` with its forbidden characters substituted, or null when that would not be reversible. */
	function encodeSegment(segment: string): string | null {
		const characters = Array.from(segment);
		const last = characters.length - 1;
		if (characters.some((character) => anywhere.has(character))) return null;
		if (last >= 0 && atEnd.has(characters[last] ?? "")) return null;
		const encoded: string[] = [];
		for (const [index, character] of characters.entries()) {
			const forbidden =
				rules.forbiddenCharacters.includes(character) || (index === last && rules.forbiddenAtEnd.includes(character));
			const substitute = forbidden ? substituteOf(character) : character;
			if (substitute === null) return null;
			encoded.push(substitute);
		}
		return encoded.join("");
	}

	/** The vault name of the Remote name `segment`. */
	function decodeSegment(segment: string): string {
		const characters = Array.from(segment);
		const last = characters.length - 1;
		return characters
			.map((character, index) => anywhere.get(character) ?? (index === last ? atEnd.get(character) : undefined) ?? character)
			.join("");
	}

	return {
		toRemote(path) {
			const segments = path.split("/").map((segment) => (encoding ? encodeSegment(segment) : segment));
			if (segments.some((segment) => segment === null || !storable(segment))) return null;
			const remote = segments.join("/");
			return rules.maxPathLength !== undefined && remote.length > rules.maxPathLength ? null : remote;
		},
		toVault(path) {
			return encoding ? path.split("/").map(decodeSegment).join("/") : path;
		},
	};
}

/** The substitutes of `characters` that have one, each mapped back to its character. */
function substitutes(characters: readonly string[]): ReadonlyMap<string, string> {
	const map = new Map<string, string>();
	for (const character of characters) {
		const substitute = substituteOf(character);
		if (substitute !== null) map.set(substitute, character);
	}
	return map;
}

/**
 * `provider` addressed by vault paths: every path it is given is encoded
 * with `codec`, and every path it returns decoded. A vault path the
 * provider cannot store fails with `nameNotRepresentable` before any
 * request; the engine leaves such paths out of sync beforehand.
 */
export function namedProvider(provider: Provider, codec: PathCodec): Provider {
	/** The Remote path of `path`; throws `nameNotRepresentable` when there is none. */
	function remote(path: VaultPath): RemotePath {
		const encoded = codec.toRemote(path);
		if (encoded === null) throw new ProviderError({ category: "nameNotRepresentable" }, `name not representable: ${path}`);
		return encoded;
	}
	/** `entry` at its vault path. */
	const decoded = <T extends RemoteEntry | Change>(entry: T): T => ({ ...entry, path: codec.toVault(entry.path) });
	const { changeFeed, fileMove, folderMove, conditionalWrite } = provider.capabilities;
	return {
		capabilities: {
			conditionalWrite,
			...(changeFeed === undefined
				? {}
				: {
						changeFeed: {
							async changes(cursor) {
								const batch = await changeFeed.changes(cursor);
								return { ...batch, changes: batch.changes.map(decoded) };
							},
						},
					}),
			...(fileMove === undefined
				? {}
				: { fileMove: { moveFile: async (from, to) => decoded(await fileMove.moveFile(remote(from), remote(to))) } }),
			...(folderMove === undefined
				? {}
				: { folderMove: { moveFolder: (from, to) => folderMove.moveFolder(remote(from), remote(to)) } }),
		},
		nameRules: provider.nameRules,
		maxFileSize: provider.maxFileSize,
		async list(): Promise<Listing> {
			const listing = await provider.list();
			return { ...listing, entries: listing.entries.map(decoded) };
		},
		read: (path) => provider.read(remote(path)),
		write: async (path, data, precondition) => decoded(await provider.write(remote(path), data, precondition)),
		delete: (path, precondition) => provider.delete(remote(path), precondition),
		createFolder: async (path) => decoded(await provider.createFolder(remote(path))),
	};
}
