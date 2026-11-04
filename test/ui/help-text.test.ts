import { describe, expect, it } from "vitest";
import { METADATA_FOLDER } from "../../src/engine/remote-metadata";
import { helpSections, practices } from "../../src/ui/help-text";
import { fill } from "../../src/ui/i18n/fill";
import { selectStrings } from "../../src/ui/i18n/strings";

const en = selectStrings("en");

describe("practices", () => {
	it("are the four that avoid most conflicts, in order", () => {
		expect(practices(en)).toEqual([en.practiceOneDeviceFirst, en.practiceEmptyOrCurrent, en.practiceWaitForSynced, en.practiceSyncAfterOffline]);
	});
});

describe("helpSections", () => {
	it("covers the practices, conflicts, outside edits, the configuration folder and skipped files, in that order", () => {
		expect(helpSections(en).map((section) => section.heading)).toEqual([
			en.helpPracticesHeading,
			en.helpConflictsHeading,
			en.helpOutsideHeading,
			en.helpConfigurationHeading,
			en.helpSkippedHeading,
		]);
	});

	it("lists the four practices as the onboarding does", () => {
		expect(helpSections(en)[0]?.list).toEqual(practices(en));
	});

	it("tells how to clear Conflict blocks and Conflict copies", () => {
		expect(helpSections(en)[1]?.paragraphs).toEqual([en.helpConflictBlocks, en.helpConflictCopies]);
	});

	it("says outside edits are best effort and names the Metadata folder not to touch", () => {
		expect(helpSections(en)[2]?.paragraphs).toEqual([en.helpOutsideEdits, fill(en.helpMetadataFolder, { folder: METADATA_FOLDER })]);
		expect(helpSections(en)[2]?.paragraphs[1]).toContain(".seamsync");
	});

	it("warns about secrets in plugin settings and the restart", () => {
		expect(helpSections(en)[3]?.paragraphs).toEqual([
			en.helpConfigurationCategories,
			en.helpConfigurationSecrets,
			en.helpConfigurationRestart,
		]);
	});

	it("tells which files never sync, then lists why the others are skipped", () => {
		const skipped = helpSections(en)[4];
		expect(skipped?.paragraphs).toEqual([en.helpNeverSynced, en.helpSkipped]);
		expect(skipped?.list).toEqual([en.helpSkippedIgnored, en.helpSkippedName, en.helpSkippedCase, en.helpSkippedSize]);
	});

	it("is the same in Russian, every text in Russian words", () => {
		const ru = selectStrings("ru");
		/** Every text of `sections`, headings first, in order. */
		const texts = (sections: ReturnType<typeof helpSections>): string[] =>
			sections.flatMap((section) => [section.heading, ...section.paragraphs, ...section.list]);
		const english = texts(helpSections(en));
		const russian = texts(helpSections(ru));

		expect(russian).toHaveLength(english.length);
		for (const [index, text] of russian.entries()) {
			expect(text).not.toBe(english[index]);
			expect(text).toMatch(/[а-яё]/i);
		}
	});
});
