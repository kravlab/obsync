import { describe, expect, it } from "vitest";
import { statusLabel } from "../../src/ui/status-label";
import { selectStrings } from "../../src/ui/i18n/strings";

describe("statusLabel", () => {
	it("names the Not connected state in English", () => {
		expect(statusLabel({ state: "notConnected" }, selectStrings("en"))).toBe("Not connected");
	});

	it("names the Not connected state in Russian", () => {
		expect(statusLabel({ state: "notConnected" }, selectStrings("ru"))).toBe("Не подключено");
	});

	it("names the Connected state in English", () => {
		expect(statusLabel({ state: "connected" }, selectStrings("en"))).toBe("Connected");
	});

	it("names the Connected state in Russian", () => {
		expect(statusLabel({ state: "connected" }, selectStrings("ru"))).toBe("Подключено");
	});
});
