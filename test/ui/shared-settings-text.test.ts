import { describe, expect, it } from "vitest";
import { DEFAULT_REMOTE_SETTINGS } from "../../src/engine/remote-metadata";
import { selectStrings } from "../../src/ui/i18n/strings";
import { settingNameText, settingValueText } from "../../src/ui/shared-settings-text";

const en = selectStrings("en");
const ru = selectStrings("ru");

describe("settingNameText", () => {
	it("names each shared setting as its settings row does", () => {
		expect(settingNameText("namePolicy", en)).toBe(en.settingsNamePolicy);
		expect(settingNameText("textExtensions", en)).toBe(en.settingsTextExtensions);
		expect(settingNameText("ignoreList", en)).toBe(en.settingsIgnoreList);
		expect(settingNameText("sizeCeilingBytes", en)).toBe(en.settingsSizeCeiling);
	});
});

describe("settingValueText", () => {
	it("tells the name policy by its choice", () => {
		expect(settingValueText("namePolicy", DEFAULT_REMOTE_SETTINGS, en)).toBe("Skip and list them");
		expect(settingValueText("namePolicy", { ...DEFAULT_REMOTE_SETTINGS, namePolicy: "encodeReversibly" }, ru)).toBe(
			"Обратимо кодировать",
		);
	});

	it("lists a list's items, or says it is empty", () => {
		expect(settingValueText("textExtensions", DEFAULT_REMOTE_SETTINGS, en)).toBe("md, txt");
		expect(settingValueText("ignoreList", DEFAULT_REMOTE_SETTINGS, en)).toBe("None");
		expect(settingValueText("ignoreList", { ...DEFAULT_REMOTE_SETTINGS, ignoreList: ["Archive/", "*.tmp"] }, ru)).toBe(
			"Archive/, *.tmp",
		);
	});

	it("tells the size limit in MiB", () => {
		expect(settingValueText("sizeCeilingBytes", DEFAULT_REMOTE_SETTINGS, en)).toBe("100 MiB");
		expect(settingValueText("sizeCeilingBytes", DEFAULT_REMOTE_SETTINGS, ru)).toBe("100 МиБ");
	});
});
