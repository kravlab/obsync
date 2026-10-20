import { createSyncEngine, type SyncEngine } from "../../src/engine/engine";
import { isWithin } from "../../src/engine/paths";
import type { RemoteEntry } from "../../src/engine/provider";
import { METADATA_FOLDER } from "../../src/engine/remote-metadata";
import { editPauseOf, pollIntervalOf } from "../../src/engine/sync-schedule";
import { FakeRemote } from "../fakes/fake-remote";
import { connectTestDevice, type TestDevice } from "../fakes/test-device";
import { bytes, text } from "./bytes";

/** Runs one "Sync now" on `device`. */
export async function syncNow(device: TestDevice): Promise<void> {
	await createSyncEngine(device.ports).sync();
}

/** The text of the vault file at `path` on `device`. */
export async function vaultText(device: TestDevice, path: string): Promise<string> {
	return text(await device.vault.read(path));
}

/** The Remote's entries mirroring a vault: everything but the Metadata folder. */
export function mirror(remote: FakeRemote): RemoteEntry[] {
	return remote.list().filter((entry) => !isWithin(entry.path, METADATA_FOLDER));
}

/** The text of the Remote file at `path`. */
export function remoteText(remote: FakeRemote, path: string): string {
	const stored = remote.get(path);
	if (stored?.kind !== "file") throw new Error(`no Remote file at ${path}`);
	return text(stored.data);
}

/** A Remote with a laptop and a phone that both hold `note.md` as `content`, synced. */
export async function syncedPair(content: string): Promise<{ remote: FakeRemote; laptop: TestDevice; phone: TestDevice }> {
	const remote = new FakeRemote();
	const laptop = connectTestDevice(remote, "Laptop");
	const phone = connectTestDevice(remote, "Phone");
	await laptop.vault.write("note.md", bytes(content));
	await syncNow(laptop);
	await syncNow(phone);
	return { remote, laptop, phone };
}

/** Sets `device`'s post-edit pause and polling interval, in seconds. */
export function setSchedule(device: TestDevice, editPauseSeconds: number, pollSeconds: number): void {
	const editPause = editPauseOf(editPauseSeconds);
	const pollInterval = pollIntervalOf(pollSeconds);
	if (editPause === null || pollInterval === null) throw new Error("a schedule the settings do not take");
	device.schedule = { editPause, pollInterval };
}

/**
 * Starts `device`'s engine, runs `body` with it once the vault-open sync
 * has settled, and stops it afterwards, also when `body` fails.
 */
export async function withStartedEngine(device: TestDevice, body: (engine: SyncEngine) => Promise<void>): Promise<void> {
	const engine = createSyncEngine(device.ports);
	const started = engine.start();
	try {
		await started.opened;
		await body(engine);
	} finally {
		started.stop();
	}
}
