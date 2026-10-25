// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConnectionService, DisconnectOutcome } from "../../src/engine/connection";
import { ObsidianConfigurationCategoriesStore } from "../../src/obsidian/configuration-categories-store";
import { ObsidianDeletionGuardStore } from "../../src/obsidian/deletion-guard-store";
import { ObsidianRequestLimitStore } from "../../src/obsidian/request-limit-store";
import { ObsidianScheduleStore } from "../../src/obsidian/schedule-store";
import { selectStrings } from "../../src/ui/i18n/strings";
import { ObsyncSettingTab } from "../../src/ui/settings-tab";
import { Notice, Plugin } from "../fakes/obsidian";
import { FakeApp } from "../fakes/obsidian-app";

const strings = selectStrings("en");

afterEach(() => {
	document.body.replaceChildren();
	vi.restoreAllMocks();
});

/** The settings tab of a connected device whose Disconnect ends as `disconnect` says, drawn into the document. */
async function connectedTab(disconnect: () => Promise<DisconnectOutcome>): Promise<ObsyncSettingTab> {
	const app = new FakeApp();
	const service: ConnectionService = {
		showStatus: () => Promise.resolve(),
		currentDevice: () => Promise.resolve({ id: "laptop-id", name: "Laptop" }),
		startAuthorization: () => Promise.reject(new Error("unused")),
		disconnect,
	};
	const tab = new ObsyncSettingTab(
		app as never,
		new Plugin(app, { id: "obsync", version: "0.1.0" }) as never,
		service,
		strings,
		() => undefined,
		() => undefined,
		new ObsidianRequestLimitStore(app as never),
		new ObsidianScheduleStore(app as never),
		new ObsidianDeletionGuardStore(app as never),
		new ObsidianConfigurationCategoriesStore(app as never),
	);
	await tab.reload();
	document.body.appendChild(tab.containerEl);
	return tab;
}

/** Presses the button with the text `text`; fails when there is none. */
function press(text: string): void {
	const found = [...document.querySelectorAll("button")].find((candidate) => candidate.textContent === text);
	if (found === undefined) throw new Error(`no button ${text}`);
	found.click();
}

describe("the settings tab's Disconnect", () => {
	it("tells the user it is disconnected", async () => {
		await connectedTab(() => Promise.resolve({ kind: "disconnected" }));

		press(strings.disconnect);

		await vi.waitFor(() => expect(Notice.shown).toEqual([strings.noticeDisconnected]));
	});

	it("tells the user a Disconnect that failed unexpectedly, and logs it, instead of leaving it unhandled", async () => {
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const bug = new TypeError("boom");
		await connectedTab(() => Promise.reject(bug));

		press(strings.disconnect);

		await vi.waitFor(() => expect(Notice.shown).toEqual([strings.noticeDisconnectFailed]));
		expect(consoleError).toHaveBeenCalledWith("obsync: disconnecting failed", bug);
	});
});
