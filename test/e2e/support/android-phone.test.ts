import { describe, expect, it } from "vitest";
import { devToolsSocket, forwardedPort, installedVersion } from "./android-phone";

describe("the DevTools socket of an app's WebView", () => {
	const unix = [
		"Num       RefCount Protocol Flags    Type St Inode Path",
		"0000000000000000: 00000002 00000000 00010000 0001 01 41234 @webview_devtools_remote_2151",
		"0000000000000000: 00000002 00000000 00010000 0001 01 41299 @webview_devtools_remote_2300",
	].join("\n");

	it("is the abstract socket named after the app's process", () => {
		expect(devToolsSocket(unix, 2300)).toBe("webview_devtools_remote_2300");
	});

	it("is absent while that process has opened none, even if another app's has a longer pid", () => {
		expect(devToolsSocket(unix, 215)).toBeUndefined();
		expect(devToolsSocket(unix, 999)).toBeUndefined();
	});
});

describe("the local port adb forward chose", () => {
	it("is the number it printed", () => {
		expect(forwardedPort("37041\n")).toBe(37041);
	});

	it("is refused when adb printed no port", () => {
		expect(() => forwardedPort("error: no devices\n")).toThrow(/adb forward printed no port: error: no devices/);
		expect(() => forwardedPort("error: device 'emulator-5584' not found\n")).toThrow(/adb forward printed no port/);
	});
});

describe("the version of an installed app", () => {
	it("is the versionName dumpsys states", () => {
		expect(installedVersion("Packages:\n  Package [md.obsidian]\n    versionCode=1 minSdk=24\n    versionName=1.14.4\n")).toBe(
			"1.14.4",
		);
	});

	it("is absent for an app not installed", () => {
		expect(installedVersion("Unable to find package: md.obsidian\n")).toBeUndefined();
	});
});
