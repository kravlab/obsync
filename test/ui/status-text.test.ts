import { describe, expect, it } from "vitest";
import { NO_CONFLICTS } from "../../src/engine/conflicts";
import { selectStrings } from "../../src/ui/i18n/strings";
import { statusText } from "../../src/ui/status-text";

const conflicts = {
	conflicted: ["a.md"],
	copies: ["b (conflict Phone 2026-10-20 1430).png"],
	configuration: [{ id: "kept-1", path: ".vault-config/app.json", keptAt: 0 }],
};
const skipped = [
	{ path: "big.pdf", reason: "tooLarge" },
	{ path: "x.tmp", reason: "ignored" },
] as const;

describe("statusText", () => {
	it("puts the conflict and skipped counts after the status, in English and Russian", () => {
		expect(statusText({ state: "synced" }, conflicts, skipped, selectStrings("en"))).toBe("Synced · 3 in conflict · 2 skipped");
		expect(statusText({ state: "synced" }, conflicts, skipped, selectStrings("ru"))).toBe(
			"Синхронизировано · конфликтов: 3 · пропущено: 2",
		);
	});

	it("leaves out a count that is zero", () => {
		expect(statusText({ state: "offline" }, NO_CONFLICTS, skipped, selectStrings("en"))).toBe("Offline · 2 skipped");
		expect(statusText({ state: "synced" }, conflicts, [], selectStrings("en"))).toBe("Synced · 3 in conflict");
		expect(statusText({ state: "synced" }, NO_CONFLICTS, [], selectStrings("en"))).toBe("Synced");
	});
});
