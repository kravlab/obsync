// Manual check 3 on the desktop: the connect window's error can be selected
// and copied by hand. Obsidian runs with no network (as every desktop
// scenario that needs no login does), so the code is never sent: the error
// is Dropbox being out of reach, and nothing reaches Dropbox, which a run
// sending made-up codes again and again could annoy.
import { describe, expect, it } from "vitest";
import { useDesktopObsidian } from "../support/desktop-obsidian";
import { PAGE_HELPERS } from "../support/page";

const obsidian = useDesktopObsidian("connect-error");

describe("check 3: the connect window's error", () => {
	it("shows a failed connect as selectable text, the message and its detail line", async () => {
		const strings = await obsidian().strings();
		const shown = await obsidian().eval(`
			${PAGE_HELPERS}
			const sync = await openSyncWindow();
			(await button(${JSON.stringify(strings.connect)}, sync)).click();
			const input = await until(() => activeDocument.querySelector(".modal input[type=text]"), 10000, "the code field");
			input.value = "a-code-never-sent";
			input.dispatchEvent(new Event("input"));
			(await button(${JSON.stringify(strings.continue)})).click();
			const message = await until(() => [...activeDocument.querySelectorAll(".seamsync-message")].find((m) => m.textContent), 30000, "the error message");
			const detail = message.parentElement.querySelector(".seamsync-message-detail");
			return {
				message: message.textContent,
				detail: detail.textContent,
				messageSelect: getComputedStyle(message).userSelect,
				detailSelect: getComputedStyle(detail).userSelect,
			};`);
		expect(shown).toMatchObject({ message: strings.errorUnreachable, messageSelect: "text", detailSelect: "text" });
		// Chromium's word for a request with no network to go out on, as seen in the run's network namespace.
		expect((shown as { detail: string }).detail).toContain("ERR_INTERNET_DISCONNECTED");
	});
});
