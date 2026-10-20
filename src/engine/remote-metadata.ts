/**
 * The Metadata folder: the one plugin-owned folder at the Remote root
 * (spec, "Remote layout and change detection"; ADR 0002). Every file in it
 * is JSON carrying a `formatVersion`, so a device can tell a format it does
 * not know (spec, "Further Notes", state format).
 *
 * Layout:
 * - `settings.json`: the shared Remote settings, the same for every device;
 * - `devices/<Device ID>.json`: one record per device, written only by it.
 */
import type { VaultPath } from "./local-vault";
import { nameOf, splitName } from "./paths";
import type { DeviceIdentity } from "./ports";
import { isFailure, type Provider, type RemotePath } from "./provider";
import { decodeUtf8 } from "./utf8";

/** The Metadata folder's name at the Remote root. */
export const METADATA_FOLDER: RemotePath = ".obsync";

/** Where the shared Remote settings live. */
export const SETTINGS_PATH: RemotePath = `${METADATA_FOLDER}/settings.json`;

/** The folder holding one record per device. */
export const DEVICES_FOLDER: RemotePath = `${METADATA_FOLDER}/devices`;

/** The format version this plugin writes. */
const FORMAT_VERSION = 1;

/**
 * The shared Remote settings (spec, "Concurrency and the no-loss
 * guarantee"). They change only by explicit user action.
 */
export interface RemoteSettings {
	/** What happens to names the provider cannot store. */
	readonly namePolicy: "skipAndReport" | "encodeReversibly";
	/** Extensions, without the dot, of files merged as text. */
	readonly textExtensions: readonly string[];
	/** Path patterns that never sync. */
	readonly ignoreList: readonly string[];
	/** Files larger than this many bytes are skipped. */
	readonly sizeCeilingBytes: number;
}

/**
 * The settings a new Remote starts with: "skip and report", Markdown and
 * plain text merged as text (JSON gets Conflict copies instead), nothing
 * ignored, and a 100 MB ceiling, the size handled in memory on Android and
 * iOS (spec, "Synced file scope").
 */
export const DEFAULT_REMOTE_SETTINGS: RemoteSettings = {
	namePolicy: "skipAndReport",
	textExtensions: ["md", "txt"],
	ignoreList: [],
	sizeCeilingBytes: 100 * 1024 * 1024,
};

/**
 * Extensions of JSON files, which never get Conflict block markers, even
 * when the text-extension list names them (spec, "Text merge").
 */
const JSON_EXTENSIONS: readonly string[] = ["json", "canvas"];

/**
 * How a sync treats a file's content, by its extension, compared without
 * case: `text` when the shared text-extension list names it and it is
 * not JSON, `json` for JSON, `other` for anything else. Text also has to
 * be UTF-8, which only the content tells.
 */
export function contentKindOf(path: VaultPath, settings: RemoteSettings): "text" | "json" | "other" {
	const extension = splitName(nameOf(path)).extension.slice(1).toLowerCase();
	if (JSON_EXTENSIONS.includes(extension)) return "json";
	return settings.textExtensions.some((listed) => listed.toLowerCase() === extension) ? "text" : "other";
}

/** The record of the device `device` in the Metadata folder. */
export function devicePath(device: DeviceIdentity): RemotePath {
	return `${DEVICES_FOLDER}/${device.id}.json`;
}

/** Encodes the shared Remote settings as the bytes of `settings.json`. */
export function encodeSettings(settings: RemoteSettings): ArrayBuffer {
	return encodeJson({ formatVersion: FORMAT_VERSION, ...settings });
}

/**
 * The shared Remote settings, read from `settings.json` at the start of
 * every sync; null when the file is missing, is not JSON, is of another
 * format version or lacks a setting.
 */
export async function readRemoteSettings(provider: Provider): Promise<RemoteSettings | null> {
	try {
		return decodeSettings((await provider.read(SETTINGS_PATH)).data);
	} catch (error) {
		if (isFailure(error, "notFound")) return null;
		throw error;
	}
}

/** The shared Remote settings in the bytes of `settings.json`, or null if they are not valid ones. */
function decodeSettings(data: ArrayBuffer): RemoteSettings | null {
	const decoded = decodeUtf8(data);
	if (decoded === null) return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(decoded);
	} catch {
		return null;
	}
	if (typeof parsed !== "object" || parsed === null) return null;
	const { formatVersion, namePolicy, textExtensions, ignoreList, sizeCeilingBytes } = parsed as Record<string, unknown>;
	if (formatVersion !== FORMAT_VERSION) return null;
	if (namePolicy !== "skipAndReport" && namePolicy !== "encodeReversibly") return null;
	if (!isStringList(textExtensions) || !isStringList(ignoreList)) return null;
	if (typeof sizeCeilingBytes !== "number" || !(sizeCeilingBytes > 0)) return null;
	return { namePolicy, textExtensions, ignoreList, sizeCeilingBytes };
}

/** Whether `value` is an array of strings. */
function isStringList(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/** Encodes a device record as the bytes of its file. */
export function encodeDeviceRecord(device: DeviceIdentity): ArrayBuffer {
	return encodeJson({ formatVersion: FORMAT_VERSION, deviceId: device.id, deviceName: device.name });
}

/**
 * Encodes `value` as UTF-8 JSON, tab-indented so the files stay readable
 * in the provider's own UI.
 */
function encodeJson(value: unknown): ArrayBuffer {
	const encoded = new TextEncoder().encode(`${JSON.stringify(value, null, "\t")}\n`);
	return encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength);
}
