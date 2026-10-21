import type { KeptConfiguration } from "../engine/ports";
import { fill } from "./i18n/fill";
import type { Strings } from "./i18n/strings";
import { timeText } from "./time-text";

/** How the restore list and the Sync window's Conflicts tab name the kept version `kept`: its file and when it was kept, in local time. */
export function keptConfigurationItem(kept: KeptConfiguration, strings: Strings): string {
	return fill(strings.keptConfigurationItem, { file: kept.path, time: timeText(kept.keptAt) });
}
