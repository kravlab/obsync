import { describe, expect, it } from "vitest";
import type { NameRules } from "../../src/engine/provider";
import { DEFAULT_REMOTE_SETTINGS, type RemoteSettings } from "../../src/engine/remote-metadata";
import {
	mergeSettings,
	namePolicyBlockers,
	parseIgnoreList,
	parseSizeCeiling,
	parseTextExtensions,
	sizeCeilingMebibytes,
} from "../../src/engine/settings-change";

/** The default shared settings with `overrides` on top. */
function settings(overrides: Partial<RemoteSettings> = {}): RemoteSettings {
	return { ...DEFAULT_REMOTE_SETTINGS, ...overrides };
}

describe("mergeSettings", () => {
	it("takes this device's change when the Remote kept the base", () => {
		const base = settings();
		const mine = settings({ ignoreList: ["Archive/"] });

		expect(mergeSettings(base, mine, base)).toEqual({ merged: mine, collisions: [] });
	});

	it("keeps the Remote's change when this device changed nothing", () => {
		const base = settings();
		const remote = settings({ sizeCeilingBytes: 5_000 });

		expect(mergeSettings(base, base, remote)).toEqual({ merged: remote, collisions: [] });
	});

	it("merges different settings changed on two devices", () => {
		const base = settings();
		const mine = settings({ ignoreList: ["Archive/"] });
		const remote = settings({ textExtensions: ["md", "txt", "org"] });

		expect(mergeSettings(base, mine, remote)).toEqual({
			merged: settings({ ignoreList: ["Archive/"], textExtensions: ["md", "txt", "org"] }),
			collisions: [],
		});
	});

	it("takes a setting both devices changed the same way without a collision", () => {
		const base = settings();
		const both = settings({ namePolicy: "encodeReversibly" });

		expect(mergeSettings(base, both, both)).toEqual({ merged: both, collisions: [] });
	});

	it("reports a setting both devices changed differently, keeping the Remote's value for now", () => {
		const base = settings();
		const mine = settings({ ignoreList: ["Archive/"], sizeCeilingBytes: 1_000 });
		const remote = settings({ ignoreList: ["*.tmp"] });

		expect(mergeSettings(base, mine, remote)).toEqual({
			merged: settings({ ignoreList: ["*.tmp"], sizeCeilingBytes: 1_000 }),
			collisions: ["ignoreList"],
		});
	});

	it("tells lists apart by order as well as by items", () => {
		const base = settings({ textExtensions: ["md", "txt"] });
		const mine = settings({ textExtensions: ["txt", "md"] });

		expect(mergeSettings(base, mine, base).merged.textExtensions).toEqual(["txt", "md"]);
	});
});

describe("the typed shared settings", () => {
	it("read text extensions separated by commas or spaces, without their dots or empty items", () => {
		expect(parseTextExtensions(" md, .TXT  org,,")).toEqual(["md", "TXT", "org"]);
		expect(parseTextExtensions("  ")).toEqual([]);
	});

	it("read the ignore list one pattern per line, trimmed, without blank lines", () => {
		expect(parseIgnoreList("Archive/\n\n  *.tmp \r\n")).toEqual(["Archive/", "*.tmp"]);
	});

	it("read the size limit as a whole number of MiB, at least one", () => {
		expect(parseSizeCeiling(" 50 ")).toBe(50 * 1024 * 1024);
		for (const typed of ["0", "1.5", "-3", "abc", ""]) expect(parseSizeCeiling(typed)).toBeNull();
	});

	it("show the size limit in whole MiB", () => {
		expect(sizeCeilingMebibytes(settings())).toBe(100);
		expect(sizeCeilingMebibytes(settings({ sizeCeilingBytes: 1_500_000 }))).toBe(1);
	});
});

/** Name rules forbidding a backslash anywhere and a space at the end, as Dropbox does. */
const RULES: NameRules = {
	forbiddenCharacters: ["\\"],
	forbiddenAtEnd: [" "],
	reservedNames: [],
	caseInsensitive: true,
};

describe("namePolicyBlockers", () => {
	it("finds nothing when no Remote name changes meaning", () => {
		expect(namePolicyBlockers(["notes/day.md", "notes"], RULES, "skipAndReport", "encodeReversibly")).toEqual([]);
		expect(namePolicyBlockers(["notes/day.md"], RULES, "encodeReversibly", "skipAndReport")).toEqual([]);
	});

	it("blocks encoding while a Remote name already holds a substitute, naming its vault path", () => {
		expect(namePolicyBlockers(["a＼b.md", "ok.md"], RULES, "skipAndReport", "encodeReversibly")).toEqual(["a＼b.md"]);
	});

	it("blocks skipping while a Remote name is encoded, naming the vault path it stands for", () => {
		expect(namePolicyBlockers(["notes/a＼b.md", "draft␠", "ok.md"], RULES, "encodeReversibly", "skipAndReport")).toEqual([
			"draft ",
			"notes/a\\b.md",
		]);
	});

	it("finds nothing when the policy stays the same", () => {
		expect(namePolicyBlockers(["a＼b.md"], RULES, "skipAndReport", "skipAndReport")).toEqual([]);
	});
});
