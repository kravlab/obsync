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
		[{ state: "syncing" }, "Syncing…", "Синхронизация…"],
		[{ state: "synced" }, "Synced", "Синхронизировано"],
		[{ state: "offline" }, "Offline", "Офлайн"],
		[{ state: "syncFailed", cause: "permanent" }, "Sync failed", "Ошибка синхронизации"],
		[{ state: "reconnectNeeded" }, "Reconnect needed", "Нужно подключиться заново"],
		[{ state: "deletionsOnHold" }, "Paused (confirm deletions)", "Пауза (подтвердите удаления)"],
		[{ state: "firstSyncWaiting" }, "First sync waiting for you", "Первая синхронизация ждёт вашего решения"],
		[{ state: "settingsCollision" }, "Paused (choose shared settings)", "Пауза (выберите общие настройки)"],
	] as const)("names the %o state in English and Russian", (status, english, russian) => {
		expect(statusLabel(status, selectStrings("en"))).toBe(english);
		expect(statusLabel(status, selectStrings("ru"))).toBe(russian);
	});
});
