import type { NamePolicy } from "../engine/name-policy";
import type { RemoteSettings } from "../engine/remote-metadata";
import { sizeCeilingMebibytes, type SharedSettingName } from "../engine/settings-change";
import { fill } from "./i18n/fill";
import type { Strings } from "./i18n/strings";

/** The name of the shared setting `name`, as its settings row shows it. */
export function settingNameText(name: SharedSettingName, strings: Strings): string {
	switch (name) {
		case "namePolicy":
			return strings.settingsNamePolicy;
		case "textExtensions":
			return strings.settingsTextExtensions;
		case "ignoreList":
			return strings.settingsIgnoreList;
		case "sizeCeilingBytes":
			return strings.settingsSizeCeiling;
	}
}

/** The choice of the name policy `policy`, as its settings row offers it. */
export function namePolicyText(policy: NamePolicy, strings: Strings): string {
	return policy === "skipAndReport" ? strings.namePolicySkip : strings.namePolicyEncode;
}

/** The value of the shared setting `name` in `settings`, as text for the collision prompt. */
export function settingValueText(name: SharedSettingName, settings: RemoteSettings, strings: Strings): string {
	switch (name) {
		case "namePolicy":
			return namePolicyText(settings.namePolicy, strings);
		case "textExtensions":
		case "ignoreList":
			return settings[name].length === 0 ? strings.settingValueNone : settings[name].join(", ");
		case "sizeCeilingBytes":
			return fill(strings.settingValueMebibytes, { count: String(sizeCeilingMebibytes(settings)) });
	}
}
