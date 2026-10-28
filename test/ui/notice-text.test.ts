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

	const renamedOnBoth = { kind: "renamedOnBoth", path: "notes/Their name.md", localPath: "notes/My name.md" } as const;

	it("names both names of a file renamed differently on two devices", () => {
		expect(noticeText(renamedOnBoth, selectStrings("en"))).toBe(
			"notes/My name.md was renamed differently on another device and is now notes/Their name.md.",
		);
		expect(noticeText(renamedOnBoth, selectStrings("ru"))).toBe(
			"notes/My name.md переименован на другом устройстве иначе и теперь называется notes/Their name.md.",
		);
	});

	const renamedThere = { kind: "renameBeatsDelete", path: "notes/New.md", deletedOn: "thisDevice" } as const;
	const renamedHere = { kind: "renameBeatsDelete", path: "notes/New.md", deletedOn: "otherDevice" } as const;

	it("tells that a rename beat a delete, on either side, in English", () => {
		expect(noticeText(renamedThere, selectStrings("en"))).toBe(
			"notes/New.md came back: it was deleted on this device but renamed on another one.",
		);
		expect(noticeText(renamedHere, selectStrings("en"))).toBe(
			"notes/New.md was kept: it was deleted on another device but renamed on this one.",
		);
	});

	it("tells that a rename beat a delete, on either side, in Russian", () => {
		expect(noticeText(renamedThere, selectStrings("ru"))).toBe(
			"notes/New.md восстановлен: он был удалён на этом устройстве, но переименован на другом.",
		);
		expect(noticeText(renamedHere, selectStrings("ru"))).toBe(
			"notes/New.md сохранён: он был удалён на другом устройстве, но переименован на этом.",
		);
	});

	const firstSyncDone = { kind: "firstSyncDone", downloaded: 3, uploaded: 2, conflicted: 1, conflictCopies: 4 } as const;

	it("sums up a First sync in English and Russian", () => {
		expect(noticeText(firstSyncDone, selectStrings("en"))).toBe(
			"First sync done: 3 downloaded, 2 uploaded, 1 with conflicts to resolve, 4 conflict copies.",
		);
		expect(noticeText(firstSyncDone, selectStrings("ru"))).toBe(
			"Первая синхронизация завершена: скачано 3, загружено 2, с конфликтами для разрешения 1, копий конфликта 4.",
		);
	});

	it("asks for a restart to apply settings that arrived, in English and Russian", () => {
		const notice = { kind: "configurationChanged" } as const;
		expect(noticeText(notice, selectStrings("en"))).toBe("Settings changed on another device. Restart Obsidian to apply them.");
		expect(noticeText(notice, selectStrings("ru"))).toBe(
			"Настройки изменились на другом устройстве. Перезапустите Obsidian, чтобы применить их.",
		);
	});

	it("tells that sync is paused until the user reconnects, in English and Russian", () => {
		const notice = { kind: "reconnectNeeded" } as const;
		expect(noticeText(notice, selectStrings("en"))).toBe(
			"Dropbox no longer accepts this device's login, so sync is paused here. Open the sync window and reconnect.",
		);
		expect(noticeText(notice, selectStrings("ru"))).toBe(
			"Dropbox больше не принимает вход с этого устройства, поэтому синхронизация здесь приостановлена. Откройте окно синхронизации и подключитесь заново.",
		);
	});

	it("names the files that kept the name policy from changing, in English and Russian", () => {
		const notice = { kind: "namePolicyRefused", paths: ["a＼b.md", "notes/c＼d.md"] } as const;
		expect(noticeText(notice, selectStrings("en"))).toBe(
			"The name policy was not changed: these files in Dropbox would get names it cannot keep. Rename them first: a＼b.md, notes/c＼d.md.",
		);
		expect(noticeText(notice, selectStrings("ru"))).toBe(
			"Правило имён не изменено: эти файлы в Dropbox получили бы имена, которые оно не сохранит. Сначала переименуйте их: a＼b.md, notes/c＼d.md.",
		);
	});
});
