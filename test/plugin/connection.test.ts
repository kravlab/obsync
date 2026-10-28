// @vitest-environment jsdom
// Manual checks 2 and 3 through the whole plugin: Disconnect in the
// settings tab revokes the login at the service; a failed connect leaves
// its line in the plugin's log file.
import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import { fill } from "../../src/ui/i18n/fill";
import { selectStrings } from "../../src/ui/i18n/strings";
import type { FakeDropbox } from "../fakes/fake-dropbox";
import { textOn, useDevices } from "../support/plugin-devices";
import { PLUGIN_WAIT, enterLoginCode, openConnectWindow, openDropbox, rowButton } from "../support/plugin-run";
import { DEVICE_TEST_TIMEOUT_MS } from "../support/timeouts";

const strings = selectStrings("en");

const newDevices = useDevices();

/** The refresh token the service gave the last login, read from its answer to the code exchange. */
function lastRefreshToken(dropbox: FakeDropbox): string {
	const tokens = dropbox.responses.flatMap((response) => {
		try {
			const body: unknown = JSON.parse(response.text);
			return typeof body === "object" && body !== null && "refresh_token" in body ? [String(body.refresh_token)] : [];
		} catch {
			return [];
		}
	});
	const token = tokens[tokens.length - 1];
	if (token === undefined) throw new Error("no login was given a refresh token");
	return token;
}

/** The HTTP status the service answers a refresh with `refreshToken` with: 200 while the login works. */
async function refreshStatus(dropbox: FakeDropbox, refreshToken: string): Promise<number> {
	const response = await dropbox.requestUrl({
		url: "https://api.dropboxapi.com/oauth2/token",
		method: "POST",
		contentType: "application/x-www-form-urlencoded",
		body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: dropbox.appKey }).toString(),
		throw: false,
	});
	return response.status;
}

describe("connecting and disconnecting in the running plugin", { timeout: DEVICE_TEST_TIMEOUT_MS }, () => {
	it("revokes the login at the service when the user disconnects in the settings tab", async () => {
		const { dropbox, devices } = newDevices();
		const account = dropbox.addAccount("account-1");
		const laptop = await devices.start("Laptop vault", { files: { "note.md": "hello" } });
		await devices.connect(laptop, account);
		await devices.startFirstSync(laptop);
		const refreshToken = lastRefreshToken(dropbox);
		expect(await refreshStatus(dropbox, refreshToken)).toBe(200);

		await vi.waitFor(() => rowButton(laptop.root, strings.settingsDropbox, strings.disconnect), PLUGIN_WAIT);
		rowButton(laptop.root, strings.settingsDropbox, strings.disconnect).click();

		await vi.waitFor(() => expect(laptop.notices()).toContain(strings.noticeDisconnected), PLUGIN_WAIT);
		expect(dropbox.requests.some((request) => request.url.endsWith("/2/auth/token/revoke"))).toBe(true);
		expect(await refreshStatus(dropbox, refreshToken)).toBe(400);
		await vi.waitFor(() => rowButton(laptop.root, strings.settingsDropbox, strings.connect), PLUGIN_WAIT);
	});

	it("appends a failed connect's line to obsync.log in the plugin's folder", async () => {
		const { devices } = newDevices();
		const laptop = await devices.start("Laptop vault");
		// Spelled out as the spec names it, not taken from the manifest the test loads the plugin with.
		const log = `${laptop.app.vault.configDir}/plugins/obsync/obsync.log`;
		const failure = fill(strings.activityConnectFailed, { cause: strings.connectFailureCodeRejected });

		openConnectWindow(laptop.root, laptop.plugin);
		await openDropbox(laptop.root);
		enterLoginCode(laptop.root, "not-a-code");

		await vi.waitFor(async () => expect(await textOn(laptop, log)).toContain(failure), PLUGIN_WAIT);
		const text = await textOn(laptop, log);
		expect(text).not.toBeNull();
		// The file was not there before, so the failure's line is its only one.
		expect(String(text).split("\n").filter((line) => line !== "")).toHaveLength(1);
	});
});
