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
import { nameOf, parentOf, splitName } from "./paths";
import type { DeviceIdentity } from "./ports";
import { isFailure, type Provider, type RemoteContent, type RemotePath } from "./provider";
import { decodeUtf8 } from "./utf8";

/** The Metadata folder's name at the Remote root. */
export const METADATA_FOLDER: RemotePath = ".seamsync";

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

/** The shared Remote settings with the revision of `settings.json` they were read from. */
export interface StoredSettings {
	readonly settings: RemoteSettings;
	/** The revision a change to them is written over, as its precondition. */
	readonly revision: string;
}

/**
 * The shared Remote settings, read from `settings.json` at the start of
 * every sync, with their revision; null when the file is missing, is not
 * JSON, is of another format version or lacks a setting.
 */
export async function readRemoteSettings(provider: Provider): Promise<StoredSettings | null> {
	try {
		const { data, revision } = await provider.read(SETTINGS_PATH);
		const settings = decodeSettings(data);
		return settings === null ? null : { settings, revision };
	} catch (error) {
		if (isFailure(error, "notFound")) return null;
		throw error;
	}
}

/**
 * Writes `settings` as the shared Remote settings over `revision`, the one
 * they were read from. Fails with `preconditionFailed`, writing nothing,
 * when another device replaced them meanwhile.
 */
export async function writeRemoteSettings(provider: Provider, settings: RemoteSettings, revision: string): Promise<void> {
	await provider.write(SETTINGS_PATH, encodeSettings(settings), { kind: "revision", revision });
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
	if ((parsed as Record<string, unknown>).formatVersion !== FORMAT_VERSION) return null;
	return parseSettings(parsed);
}

/** The shared Remote settings in `value`, as stored, or null if it holds no valid ones. */
export function parseSettings(value: unknown): RemoteSettings | null {
	if (typeof value !== "object" || value === null) return null;
	const { namePolicy, textExtensions, ignoreList, sizeCeilingBytes } = value as Record<string, unknown>;
	if (namePolicy !== "skipAndReport" && namePolicy !== "encodeReversibly") return null;
	if (!isStringList(textExtensions) || !isStringList(ignoreList)) return null;
	if (typeof sizeCeilingBytes !== "number" || !(sizeCeilingBytes > 0)) return null;
	return { namePolicy, textExtensions, ignoreList, sizeCeilingBytes };
}

/** Whether `value` is an array of strings. */
function isStringList(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/**
 * How long a "First sync in progress" mark holds: six hours, enough for
 * the First sync of a large vault on a phone, and for the clocks of two
 * devices disagreeing. An older mark was left by a First sync that never
 * finished.
 */
export const FIRST_SYNC_MARK_MS = 6 * 60 * 60 * 1_000;

/**
 * The name of a device whose record holds a "First sync in progress" mark
 * within `FIRST_SYNC_MARK_MS` of `now`, either way, by this device's clock;
 * null when there is none. Finding the records takes a full listing.
 * Records this plugin cannot read are passed over.
 */
export async function deviceNameInFirstSync(provider: Provider, now: number): Promise<string | null> {
	const marked = (await readDeviceRecords(provider)).find(
		({ firstSyncStartedAt }) => firstSyncStartedAt !== undefined && Math.abs(now - firstSyncStartedAt) < FIRST_SYNC_MARK_MS,
	);
	return marked?.device.name ?? null;
}

/** One device's record in the Metadata folder, as read. */
export interface DeviceRecord {
	readonly device: DeviceIdentity;
	/** The revision it was read at, for forgetting it only as read. */
	readonly revision: string;
	/** The "First sync in progress" mark: when the device started its First sync, by its own clock. */
	readonly firstSyncStartedAt?: number;
}

/**
 * The records of every device registered on the Remote, in listing order.
 * Finding them takes a full listing. Records this plugin cannot read, and
 * any that vanish while being read, are passed over.
 */
export async function readDeviceRecords(provider: Provider): Promise<DeviceRecord[]> {
	const { entries } = await provider.list();
	const records: DeviceRecord[] = [];
	for (const entry of entries) {
		if (entry.kind !== "file" || parentOf(entry.path) !== DEVICES_FOLDER) continue;
		let content: RemoteContent;
		try {
			content = await provider.read(entry.path);
		} catch (error) {
			if (isFailure(error, "notFound")) continue;
			throw error;
		}
		const record = decodeDeviceRecord(content);
		if (record !== null) records.push(record);
	}
	return records;
}

/**
 * Deletes the record `record` from the Metadata folder ("Forget this
 * device"). Fails with `preconditionFailed`, deleting nothing, when its
 * device rewrote it since it was read.
 */
export async function forgetDeviceRecord(provider: Provider, record: DeviceRecord): Promise<void> {
	await provider.delete(devicePath(record.device), { kind: "revision", revision: record.revision });
}

/** The device record in `content`, or null if it holds none of this plugin's format. */
function decodeDeviceRecord({ data, revision }: RemoteContent): DeviceRecord | null {
	const parsed = parseJson(data);
	if (parsed === null || parsed.formatVersion !== FORMAT_VERSION) return null;
	const { deviceId, deviceName, firstSyncStartedAt } = parsed;
	if (typeof deviceId !== "string" || typeof deviceName !== "string") return null;
	const device = { id: deviceId, name: deviceName };
	return typeof firstSyncStartedAt === "number" ? { device, revision, firstSyncStartedAt } : { device, revision };
}

/** The JSON object in `data`, UTF-8, or null if it holds none. */
function parseJson(data: ArrayBuffer): Record<string, unknown> | null {
	const decoded = decodeUtf8(data);
	if (decoded === null) return null;
	try {
		const parsed: unknown = JSON.parse(decoded);
		return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
	} catch {
		return null;
	}
}

/**
 * Encodes a device record as the bytes of its file; `firstSyncStartedAt`,
 * when given, is the "First sync in progress" mark: when this device
 * started its First sync, in ms since the epoch by its own clock.
 */
export function encodeDeviceRecord(device: DeviceIdentity, firstSyncStartedAt?: number): ArrayBuffer {
	const mark = firstSyncStartedAt === undefined ? {} : { firstSyncStartedAt };
	return encodeJson({ formatVersion: FORMAT_VERSION, deviceId: device.id, deviceName: device.name, ...mark });
}

/**
 * Writes the record of `device` in the Metadata folder, replacing what it
 * wrote before, with the "First sync in progress" mark when
 * `firstSyncStartedAt` is given. Only this device writes its record.
 */
export async function writeDeviceRecord(
	provider: Provider,
	device: DeviceIdentity,
	firstSyncStartedAt?: number,
): Promise<void> {
	await provider.createFolder(METADATA_FOLDER);
	await provider.createFolder(DEVICES_FOLDER);
	await provider.write(devicePath(device), encodeDeviceRecord(device, firstSyncStartedAt));
}

/**
 * Encodes `value` as UTF-8 JSON, tab-indented so the files stay readable
 * in the provider's own UI.
 */
function encodeJson(value: unknown): ArrayBuffer {
	const encoded = new TextEncoder().encode(`${JSON.stringify(value, null, "\t")}\n`);
	return encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength);
}
