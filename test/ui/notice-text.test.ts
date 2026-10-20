import { describe, expect, it } from "vitest";
import { selectStrings } from "../../src/ui/i18n/strings";
import { noticeText } from "../../src/ui/notice-text";

describe("noticeText", () => {
	const created = {
		kind: "conflictCopyCreated",
		path: "photos/Photo.png",
		copyPath: "photos/Photo (conflict Phone 2026-10-20 1430).png",
	} as const;

	it("names the file and its Conflict copy in English", () => {
		expect(noticeText(created, selectStrings("en"))).toBe(
			"photos/Photo.png changed on another device too and could not be merged. " +
				"This device's version is kept as photos/Photo (conflict Phone 2026-10-20 1430).png.",
		);
	});

	it("names the file and its Conflict copy in Russian", () => {
		expect(noticeText(created, selectStrings("ru"))).toBe(
			"photos/Photo.png изменён и на другом устройстве, объединить версии не удалось. " +
				"Версия этого устройства сохранена как photos/Photo (conflict Phone 2026-10-20 1430).png.",
		);
	});
});
