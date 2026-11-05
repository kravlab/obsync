import { describe, expect, it } from "vitest";
import { selectStrings } from "../../src/ui/i18n/strings";
import { deletionPromptText } from "../../src/ui/deletion-prompt-text";

describe("deletionPromptText", () => {
	const en = selectStrings("en");
	const ru = selectStrings("ru");

	it("says why the sync stopped, for each reason, in English", () => {
		const prompt = { toRemote: ["a.md"], toVault: [] };
		expect(deletionPromptText({ ...prompt, reason: "threshold" }, en).reason).toBe(
			"This sync would delete more files than the deletion guard allows.",
		);
		expect(deletionPromptText({ ...prompt, reason: "missingVault" }, en).reason).toBe("This vault has none of its synced files left.");
		expect(deletionPromptText({ ...prompt, reason: "emptyRemote" }, en).reason).toBe("Dropbox has none of the synced files left.");
	});

	it("counts each direction, leaving out one with nothing to delete", () => {
		expect(deletionPromptText({ reason: "threshold", toRemote: ["a.md", "b.md"], toVault: [] }, en)).toMatchObject({
			toRemote: "Deleted on this device, to delete in Dropbox: 2",
			toVault: null,
		});
		expect(deletionPromptText({ reason: "threshold", toRemote: [], toVault: ["c.md"] }, en)).toMatchObject({
			toRemote: null,
			toVault: "Deleted on another device, to move to this device's trash: 1",
		});
	});

	it("says the same in Russian", () => {
		expect(deletionPromptText({ reason: "threshold", toRemote: ["a.md"], toVault: ["c.md"] }, ru)).toEqual({
			reason: "Эта синхронизация удалила бы больше файлов, чем позволяет защита от удалений.",
			toRemote: "Удалены на этом устройстве, будут удалены в Dropbox: 1",
			toVault: "Удалены на другом устройстве, будут перемещены в корзину этого устройства: 1",
		});
		expect(deletionPromptText({ reason: "missingVault", toRemote: [], toVault: [] }, ru).reason).toBe(
			"В этом хранилище не осталось ни одного синхронизированного файла.",
		);
		expect(deletionPromptText({ reason: "emptyRemote", toRemote: [], toVault: [] }, ru).reason).toBe(
			"В Dropbox не осталось ни одного синхронизированного файла.",
		);
	});
});
