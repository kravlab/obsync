import { createSyncEngine } from "../../src/engine/engine";
import { isWithin } from "../../src/engine/paths";
import type { RemoteEntry } from "../../src/engine/provider";
import { METADATA_FOLDER } from "../../src/engine/remote-metadata";
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
