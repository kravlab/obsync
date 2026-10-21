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

	it.each([
		["syncing", "Syncing…", "Синхронизация…"],
		["synced", "Synced", "Синхронизировано"],
		["offline", "Offline", "Офлайн"],
		["syncFailed", "Sync failed", "Ошибка синхронизации"],
		["deletionsOnHold", "Deletions waiting for you", "Удаления ждут вашего решения"],
		["firstSyncWaiting", "First sync waiting for you", "Первая синхронизация ждёт вашего решения"],
	] as const)("names the %s state in English and Russian", (state, english, russian) => {
		expect(statusLabel({ state }, selectStrings("en"))).toBe(english);
		expect(statusLabel({ state }, selectStrings("ru"))).toBe(russian);
	});
});
