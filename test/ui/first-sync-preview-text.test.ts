import { describe, expect, it } from "vitest";
import type { FirstSyncPreview } from "../../src/engine/first-sync";
import { firstSyncPreviewText } from "../../src/ui/first-sync-preview-text";
import { selectStrings } from "../../src/ui/i18n/strings";

const preview: FirstSyncPreview = {
	toDownload: ["a.md", "b.md"],
	toUpload: ["c.md"],
	identical: [],
	differing: [
		{ path: "d.md", outcome: "merged" },
		{ path: "e.png", outcome: "conflictCopy" },
	],
};

describe("firstSyncPreviewText", () => {
	it("counts each kind of file and says what happens to each differing file, in English", () => {
		const text = firstSyncPreviewText(preview, selectStrings("en"));
		expect(text).toMatchObject({
			toDownload: "To download from Dropbox: 2",
			toUpload: "To upload to Dropbox: 1",
			identical: "Already the same on both: 0",
			differing: "Different on both: 2",
		});
		expect(text.differingFiles).toEqual([
			"d.md: Merged, every difference marked",
			"e.png: This device's version kept as a conflict copy",
		]);
	});

	it("says the same in Russian", () => {
		const text = firstSyncPreviewText(preview, selectStrings("ru"));
		expect(text).toMatchObject({
			toDownload: "Скачать из Dropbox: 2",
			toUpload: "Загрузить в Dropbox: 1",
			identical: "Уже одинаковые с обеих сторон: 0",
			differing: "Различаются: 2",
		});
		expect(text.differingFiles).toEqual([
			"d.md: Будет объединён, каждое различие отмечено",
			"e.png: Версия этого устройства сохранится как копия конфликта",
		]);
	});
});
