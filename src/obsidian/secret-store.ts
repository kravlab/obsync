import type { App } from "obsidian";
import type { SecretStore } from "../engine/ports";

/**
 * The Secret store over Obsidian's `SecretStorage`, which keeps secrets on
 * this device only, never in `data.json`, the vault or the Remote.
 *
 * `SecretStorage` (Obsidian 1.11.4–1.14.4) has no way to remove a secret,
 * so a removed secret is stored as the empty string, and the empty string
 * reads back as no secret.
 */
export class ObsidianSecretStore implements SecretStore {
	/** @param app the Obsidian app whose `secretStorage` holds the secrets */
	constructor(private readonly app: App) {}

	getSecret(id: string): string | null {
		const secret = this.app.secretStorage.getSecret(id);
		return secret === "" ? null : secret;
	}

	setSecret(id: string, secret: string): void {
		this.app.secretStorage.setSecret(id, secret);
	}

	deleteSecret(id: string): void {
		this.app.secretStorage.setSecret(id, "");
	}
}
