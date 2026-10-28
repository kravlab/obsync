/**
 * Changing the shared Remote settings (spec, "Concurrency and the no-loss
 * guarantee"): how a change made on this device meets one another device
 * made meanwhile, and what stops a change of the name policy.
 */
import { ConnectionChanged } from "./connection-epoch";
import type { VaultPath } from "./local-vault";
import { pathCodec, type NamePolicy } from "./name-policy";
import type { DeviceStore, UiPort } from "./ports";
import { isFailure, type NameRules, type Provider, type RemotePath } from "./provider";
import { readRemoteSettings, writeRemoteSettings, type RemoteSettings, type StoredSettings } from "./remote-metadata";
import { MEBIBYTE } from "./request-limit";
import { parseWholeNumber } from "./whole-number";

/** The name of one shared Remote setting. */
export type SharedSettingName = keyof RemoteSettings;

/** Every shared Remote setting, in the order the user sees them. */
export const SHARED_SETTING_NAMES: readonly SharedSettingName[] = [
	"namePolicy",
	"textExtensions",
	"ignoreList",
	"sizeCeilingBytes",
];

/**
 * A change of the shared Remote settings the user made on this device,
 * kept on it until a sync writes it to the Remote.
 */
export interface SettingsChange {
	/** The settings the change was made from, as this device knew them. */
	readonly base: RemoteSettings;
	/** The settings the user wants. */
	readonly wanted: RemoteSettings;
}

/** The text extensions the user typed, separated by commas or spaces, each without a leading dot. */
export function parseTextExtensions(typed: string): string[] {
	return typed
		.split(/[\s,]+/)
		.map((item) => item.replace(/^\.+/, ""))
		.filter((item) => item !== "");
}

/** The ignore list the user typed, one pattern per line, trimmed, blank lines left out. */
export function parseIgnoreList(typed: string): string[] {
	return typed
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line !== "");
}

/**
 * The size ceiling the user typed as a whole number of MiB, at least one,
 * in bytes; null when it is not one. A ceiling above the provider's
 * largest file is taken, and a sync applies the provider's instead.
 */
export function parseSizeCeiling(typed: string): number | null {
	const mebibytes = parseWholeNumber(typed, 1, Math.floor(Number.MAX_SAFE_INTEGER / MEBIBYTE));
	return mebibytes === null ? null : mebibytes * MEBIBYTE;
}

/** The size ceiling of `settings` in whole MiB, as the settings show it. */
export function sizeCeilingMebibytes(settings: RemoteSettings): number {
	return Math.round(settings.sizeCeilingBytes / MEBIBYTE);
}

/** The outcome of merging a change made here with the settings on the Remote. */
export interface SettingsMerge {
	/** The settings to write: the Remote's value for every colliding setting until the user picks one. */
	readonly merged: RemoteSettings;
	/** The settings this device and another both changed, to different values. */
	readonly collisions: readonly SharedSettingName[];
}

/**
 * Merges `mine`, the settings this device wants, made from `base`, with
 * `remote`, the settings on the Remote now, one setting at a time: a
 * setting only one side changed takes that side's value, one both changed
 * alike takes it too, and one both changed differently is a collision.
 */
export function mergeSettings(base: RemoteSettings, mine: RemoteSettings, remote: RemoteSettings): SettingsMerge {
	let merged = remote;
	const collisions: SharedSettingName[] = [];
	for (const name of SHARED_SETTING_NAMES) {
		if (sameValue(mine[name], base[name]) || sameValue(mine[name], remote[name])) continue;
		if (sameValue(remote[name], base[name])) merged = { ...merged, [name]: mine[name] };
		else collisions.push(name);
	}
	return { merged, collisions };
}

/** Whether `a` and `b` hold the same value for every setting. */
export function sameSettings(a: RemoteSettings, b: RemoteSettings): boolean {
	return SHARED_SETTING_NAMES.every((name) => sameValue(a[name], b[name]));
}

/**
 * What the user is asked when a change made here collides with one made
 * on another device: the settings this device wants, those on the Remote
 * now, and which of them both changed differently.
 */
export interface SettingsCollisionPrompt {
	readonly collisions: readonly SharedSettingName[];
	readonly mine: RemoteSettings;
	readonly remote: RemoteSettings;
}

/**
 * The user's answer to a collision: the colliding settings that take this
 * device's value, every other one keeping the Remote's; null when the
 * prompt was closed without an answer, which holds sync.
 */
export type SettingsCollisionAnswer = { readonly keepMine: readonly SharedSettingName[] } | null;

/** What bringing a change to the Remote came to, for the sync that did it. */
export type AppliedSettings =
	/** The settings the sync goes on with. */
	| { readonly kind: "applied"; readonly settings: RemoteSettings }
	/** The collision prompt was closed without an answer: nothing was written, and the change waits. */
	| { readonly kind: "held" }
	/** The settings another device wrote meanwhile cannot be read. */
	| { readonly kind: "unreadable" };

/**
 * Brings the change waiting on this device, if any, to the Remote at the
 * start of a sync. The change is merged with `stored`, the settings just
 * read; a collision asks the user through `ui` which value each colliding
 * setting keeps. A change of the name policy is checked against a full
 * listing of the Remote: while any entry stops it (`namePolicyBlockers`),
 * the policy stays, the user is told which entries, and the other settings
 * still change. The result is written over the revision read; when
 * another device replaced the settings meanwhile, they are read again and
 * the result, now made from those the user saw, merged again. Once
 * written, the change is dropped, unless the user made a newer one
 * meanwhile, which the next sync brings; one that joined this change is
 * now made from the settings written. The settings the sync goes on
 * with are kept as the ones known on this device. A disconnect during the
 * prompt, which `inRunEpoch` tells, ends it writing nothing.
 */
export async function applySettingsChange(
	provider: Provider,
	deviceStore: DeviceStore,
	ui: Pick<UiPort, "askSettingsCollision" | "showNotice">,
	stored: StoredSettings,
	inRunEpoch: () => boolean,
): Promise<AppliedSettings> {
	const pending = await deviceStore.loadSettingsChange();
	if (pending === null) {
		await deviceStore.saveKnownSettings(stored.settings);
		return { kind: "applied", settings: stored.settings };
	}
	let current = stored;
	let change = pending;
	for (;;) {
		const { merged, collisions } = mergeSettings(change.base, change.wanted, current.settings);
		let result = merged;
		if (collisions.length > 0) {
			const answer = await ui.askSettingsCollision({ collisions, mine: change.wanted, remote: current.settings });
			if (!inRunEpoch()) throw new ConnectionChanged();
			if (answer === null) return { kind: "held" };
			for (const name of answer.keepMine) result = { ...result, [name]: change.wanted[name] };
		}
		const policy = current.settings.namePolicy;
		if (result.namePolicy !== policy) {
			const { entries } = await provider.list();
			const blockers = namePolicyBlockers(
				entries.map((entry) => entry.path),
				provider.nameRules,
				policy,
				result.namePolicy,
			);
			if (blockers.length > 0) {
				ui.showNotice({ kind: "namePolicyRefused", paths: blockers });
				result = { ...result, namePolicy: policy };
			}
		}
		if (!sameSettings(result, current.settings)) {
			try {
				await writeRemoteSettings(provider, result, current.revision);
			} catch (error) {
				if (!isFailure(error, "preconditionFailed")) throw error;
				const reread = await readRemoteSettings(provider);
				if (reread === null) return { kind: "unreadable" };
				change = { base: current.settings, wanted: result };
				current = reread;
				continue;
			}
		}
		const latest = await deviceStore.loadSettingsChange();
		if (latest !== null && sameChange(latest, pending)) await deviceStore.saveSettingsChange(null);
		// A newer change that joined this one was made from what is written now.
		else if (latest !== null && sameSettings(latest.base, pending.base)) {
			await deviceStore.saveSettingsChange({ base: result, wanted: latest.wanted });
		}
		await deviceStore.saveKnownSettings(result);
		return { kind: "applied", settings: result };
	}
}

/** Whether two changes are the same one. */
function sameChange(a: SettingsChange, b: SettingsChange): boolean {
	return sameSettings(a.base, b.base) && sameSettings(a.wanted, b.wanted);
}

/** Whether two values of a setting are equal: lists item by item, in order. */
function sameValue(a: RemoteSettings[SharedSettingName], b: RemoteSettings[SharedSettingName]): boolean {
	if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((item, index) => item === b[index]);
	return a === b;
}

/**
 * The vault paths, sorted, of the Remote entries at `paths` that stop a
 * change of the name policy from `from` to `to` under the name rules
 * `rules`: those whose vault path under `from` the provider cannot store
 * under `to` as the same Remote name, so the change would either leave
 * them out or read them as other files. No name can be found for them, so
 * the change waits until the user renames them.
 */
export function namePolicyBlockers(
	paths: readonly RemotePath[],
	rules: NameRules,
	from: NamePolicy,
	to: NamePolicy,
): VaultPath[] {
	const before = pathCodec(rules, from);
	const after = pathCodec(rules, to);
	return paths
		.filter((path) => after.toRemote(before.toVault(path)) !== path)
		.map((path) => before.toVault(path))
		.sort();
}
