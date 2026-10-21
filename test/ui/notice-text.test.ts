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

	const deletedHere = { kind: "restoredAfterDelete", path: "notes/Plan.md", deletedOn: "thisDevice" } as const;
	const deletedThere = { kind: "restoredAfterDelete", path: "notes/Plan.md", deletedOn: "otherDevice" } as const;

	it("tells in English that a file deleted here came back because another device edited it", () => {
		expect(noticeText(deletedHere, selectStrings("en"))).toBe(
			"notes/Plan.md came back: it was deleted on this device but edited on another one.",
		);
	});

	it("tells in English that a file edited here was kept though another device deleted it", () => {
		expect(noticeText(deletedThere, selectStrings("en"))).toBe(
			"notes/Plan.md was kept: it was deleted on another device but edited on this one.",
		);
	});

	it("tells both in Russian", () => {
		expect(noticeText(deletedHere, selectStrings("ru"))).toBe(
			"notes/Plan.md восстановлен: он был удалён на этом устройстве, но изменён на другом.",
		);
		expect(noticeText(deletedThere, selectStrings("ru"))).toBe(
			"notes/Plan.md сохранён: он был удалён на другом устройстве, но изменён на этом.",
		);
	});
});
