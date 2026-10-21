import { REMOTE_CONFIGURATION_FOLDER, type ConfigurationCategories } from "../../src/engine/configuration";
import { FakeRemote, type FakeServiceOptions } from "../fakes/fake-remote";
import { connectTestDevice, type TestDevice } from "../fakes/test-device";
import { forgetNotices, syncNow, writeVaultFile } from "./sync";

/** Every configuration category on. */
export const ALL_CATEGORIES: ConfigurationCategories = { settingsAndHotkeys: true, themesAndSnippets: true, plugins: true };

/** The Remote path of `path`, relative to the configuration folder. */
export function remoteConfig(path: string): string {
	return `${REMOTE_CONFIGURATION_FOLDER}/${path}`;
}

/** The vault path of `path`, relative to `device`'s configuration folder. */
export function localConfig(device: TestDevice, path: string): string {
	return `${device.vault.configDir}/${path}`;
}

/** Writes `content` to `path`, relative to `device`'s configuration folder, creating the folders above it. */
export async function writeConfig(device: TestDevice, path: string, content: string): Promise<void> {
	await writeVaultFile(device, localConfig(device, path), content);
}

/**
 * A Remote on a service with `service`, with a laptop and a phone that
 * name their configuration folders differently (the phone's is
 * `.phone-config`), both through a First sync, notices forgotten.
 * Categories are left off.
 */
export async function laptopAndPhone(
	service: FakeServiceOptions = {},
): Promise<{ remote: FakeRemote; laptop: TestDevice; phone: TestDevice }> {
	const remote = new FakeRemote(service);
	const laptop = connectTestDevice(remote, "Laptop");
	const phone = connectTestDevice(remote, "Phone", { configDir: ".phone-config" });
	await syncNow(laptop);
	await syncNow(phone);
	forgetNotices(laptop, phone);
	return { remote, laptop, phone };
}
