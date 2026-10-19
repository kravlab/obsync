import { Platform } from "obsidian";
import type { Strings } from "./i18n/strings";

/**
 * The name a device is offered when it connects, after its platform; the
 * user can change it in the connect window.
 */
export function defaultDeviceName(strings: Strings): string {
	if (Platform.isIosApp) return Platform.isTablet ? strings.deviceIpad : strings.deviceIphone;
	if (Platform.isAndroidApp) return strings.deviceAndroid;
	return strings.deviceDesktop;
}
