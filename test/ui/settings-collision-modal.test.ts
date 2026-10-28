// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_REMOTE_SETTINGS } from "../../src/engine/remote-metadata";
import type { SettingsCollisionPrompt } from "../../src/engine/settings-change";
import { fill } from "../../src/ui/i18n/fill";
import { selectStrings } from "../../src/ui/i18n/strings";
import { SettingsCollisionModal } from "../../src/ui/settings-collision-modal";

const strings = selectStrings("en");

afterEach(() => {
	document.body.replaceChildren();
});

/** A collision of the ignore list and the size limit. */
const PROMPT: SettingsCollisionPrompt = {
	collisions: ["ignoreList", "sizeCeilingBytes"],
	mine: { ...DEFAULT_REMOTE_SETTINGS, ignoreList: ["*.tmp"], sizeCeilingBytes: 50 * 1024 * 1024 },
	remote: { ...DEFAULT_REMOTE_SETTINGS, ignoreList: ["Archive/"], sizeCeilingBytes: 10 * 1024 * 1024 },
};

/** The collision prompt asked, open, with its pending answer. */
function ask(): { modal: SettingsCollisionModal; answer: ReturnType<SettingsCollisionModal["ask"]> } {
	const modal = new SettingsCollisionModal({} as never, strings, PROMPT);
	const answer = modal.ask();
	return { modal, answer };
}

describe("the settings collision prompt", () => {
	it("offers both values of each colliding setting", () => {
		const { modal } = ask();

		const choices = [...modal.contentEl.querySelectorAll("option")].map((option) => option.textContent);
		expect(choices).toEqual([
			fill(strings.collisionMine, { value: "*.tmp" }),
			fill(strings.collisionRemote, { value: "Archive/" }),
			fill(strings.collisionMine, { value: "50 MiB" }),
			fill(strings.collisionRemote, { value: "10 MiB" }),
		]);
	});

	it("answers with the settings left at this device's value once applied", async () => {
		const { modal, answer } = ask();
		const [, size] = modal.contentEl.querySelectorAll("select");
		if (size === undefined) throw new Error("no choice for the size limit");
		size.value = "remote";
		size.dispatchEvent(new Event("change"));

		[...modal.contentEl.querySelectorAll("button")].find((button) => button.textContent === strings.collisionApply)?.click();

		expect(await answer).toEqual({ keepMine: ["ignoreList"] });
	});

	it("answers null when closed without applying", async () => {
		const { modal, answer } = ask();

		modal.close();

		expect(await answer).toBeNull();
	});
});
