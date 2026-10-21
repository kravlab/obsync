import { localDateTime } from "../engine/local-time";
import type { KeptConfiguration } from "../engine/ports";
import { fill } from "./i18n/fill";
import type { Strings } from "./i18n/strings";

/**
 * The line of the status click notice telling how many local
 * configuration versions are kept to restore, and the command that
 * restores them, in the user's language; null when none is kept.
 */
export function keptConfigurationLine(kept: readonly KeptConfiguration[], strings: Strings): string | null {
	if (kept.length === 0) return null;
	return fill(strings.keptConfigurationLine, { count: String(kept.length), command: strings.restoreConfiguration });
}

/** How the restore list names the kept version `kept`: its file and when it was kept, in local time. */
export function keptConfigurationItem(kept: KeptConfiguration, strings: Strings): string {
	const { day, hours, minutes } = localDateTime(kept.keptAt);
	return fill(strings.keptConfigurationItem, { file: kept.path, time: `${day} ${hours}:${minutes}` });
}
