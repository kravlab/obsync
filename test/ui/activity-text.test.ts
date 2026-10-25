import { describe, expect, it } from "vitest";
import type { SyncFailureCause } from "../../src/engine/status";
import { activityLine } from "../../src/ui/activity-text";
import { selectStrings } from "../../src/ui/i18n/strings";

/** 2026-10-20 14:30 on the test machine's own clock. */
const AFTERNOON = new Date(2026, 9, 20, 14, 30).getTime();

describe("activityLine", () => {
	it("tells a notice as the notice says it, after its local time", () => {
		const event = { at: AFTERNOON, kind: "notice", notice: { kind: "configurationChanged" } } as const;

		expect(activityLine(event, selectStrings("en"))).toBe(
			"2026-10-20 14:30 Settings changed on another device. Restart Obsidian to apply them.",
		);
	});

	it("tells a status by its label, in English and Russian", () => {
		const event = { at: AFTERNOON, kind: "status", status: { state: "reconnectNeeded" } } as const;

		expect(activityLine(event, selectStrings("en"))).toBe("2026-10-20 14:30 Reconnect needed");
		expect(activityLine(event, selectStrings("ru"))).toBe("2026-10-20 14:30 Нужно подключиться заново");
	});

	it.each([
		["auth", "Dropbox refused the login", "Dropbox отклонил вход"],
		["throttled", "Dropbox asked to slow down", "Dropbox попросил делать запросы реже"],
		["transient", "Dropbox could not be reached", "Dropbox недоступен"],
		["notFound", "A file was not found in Dropbox", "Файл не найден в Dropbox"],
		["preconditionFailed", "A file changed in Dropbox during the sync", "Файл изменился в Dropbox во время синхронизации"],
		["cursorLost", "Dropbox reset its list of changes", "Dropbox сбросил свой список изменений"],
		["quotaExceeded", "Dropbox is full", "В Dropbox нет места"],
		["tooLarge", "A file is too large for Dropbox", "Файл слишком велик для Dropbox"],
		["nameNotRepresentable", "Dropbox cannot store a file name", "Dropbox не может сохранить имя файла"],
		["permanent", "Dropbox refused a request", "Dropbox отклонил запрос"],
		["unsupportedProvider", "This provider cannot be synced", "С этим провайдером синхронизация невозможна"],
		["unreadableSettings", "The shared settings in Dropbox are missing or unreadable", "Общих настроек в Dropbox нет или их не прочитать"],
		["bug", "The plugin hit an error", "В плагине произошла ошибка"],
	] as const)("tells why a sync failed with %s, in English and Russian", (cause: SyncFailureCause, english, russian) => {
		const event = { at: AFTERNOON, kind: "status", status: { state: "syncFailed", cause } } as const;

		expect(activityLine(event, selectStrings("en"))).toBe(`2026-10-20 14:30 Sync failed. ${english}.`);
		expect(activityLine(event, selectStrings("ru"))).toBe(`2026-10-20 14:30 Ошибка синхронизации. ${russian}.`);
	});

	it("tells a failed sync's detail in parentheses, as the provider wrote it", () => {
		const event = {
			at: AFTERNOON,
			kind: "status",
			status: { state: "syncFailed", cause: "permanent", detail: "HTTP 400: Error in call to API" },
		} as const;

		expect(activityLine(event, selectStrings("en"))).toBe(
			"2026-10-20 14:30 Sync failed. Dropbox refused a request. (HTTP 400: Error in call to API)",
		);
		expect(activityLine(event, selectStrings("ru"))).toBe(
			"2026-10-20 14:30 Ошибка синхронизации. Dropbox отклонил запрос. (HTTP 400: Error in call to API)",
		);
	});

	it("tells a failure while connecting, with its detail, in English and Russian", () => {
		const event = { at: AFTERNOON, kind: "connectFailed", cause: "permanent", detail: "HTTP 400: bad client_id" } as const;

		expect(activityLine(event, selectStrings("en"))).toBe(
			"2026-10-20 14:30 Connecting failed. Dropbox refused a request. (HTTP 400: bad client_id)",
		);
		expect(activityLine(event, selectStrings("ru"))).toBe(
			"2026-10-20 14:30 Не удалось подключиться. Dropbox отклонил запрос. (HTTP 400: bad client_id)",
		);
	});

	it("tells a failure while connecting without parentheses when it has no detail", () => {
		const event = { at: AFTERNOON, kind: "connectFailed", cause: "transient" } as const;

		expect(activityLine(event, selectStrings("en"))).toBe(
			"2026-10-20 14:30 Connecting failed. Dropbox could not be reached.",
		);
	});

	it.each([
		[
			"codeRejected",
			"Connecting failed. Dropbox did not accept the code.",
			"Не удалось подключиться. Dropbox не принял код.",
		],
		[
			"otherAccount",
			"Connecting failed. This device is connected to a different Dropbox account.",
			"Не удалось подключиться. Это устройство подключено к другому аккаунту Dropbox.",
		],
		[
			"nameTaken",
			"Connecting failed. A folder with this name already exists.",
			"Не удалось подключиться. Папка с таким именем уже есть.",
		],
		[
			"invalidName",
			'Connecting failed. The folder name contains "/".',
			"Не удалось подключиться. В имени папки есть «/».",
		],
		[
			"unsupportedProvider",
			"Connecting failed. This provider cannot be synced.",
			"Не удалось подключиться. С этим провайдером синхронизация невозможна.",
		],
		[
			"firstSyncInProgress",
			"Connecting failed. Another device is doing its first sync with this folder.",
			"Не удалось подключиться. Другое устройство выполняет первую синхронизацию с этой папкой.",
		],
		["bug", "Connecting failed. The plugin hit an error.", "Не удалось подключиться. В плагине произошла ошибка."],
	] as const)("tells a connect failure for %s in English and Russian", (cause, english, russian) => {
		const event = { at: AFTERNOON, kind: "connectFailed", cause } as const;

		expect(activityLine(event, selectStrings("en"))).toBe(`2026-10-20 14:30 ${english}`);
		expect(activityLine(event, selectStrings("ru"))).toBe(`2026-10-20 14:30 ${russian}`);
	});

	it("tells a revoke that failed on disconnect, with its detail, in English and Russian", () => {
		const event = { at: AFTERNOON, kind: "revokeFailed", cause: "transient", detail: "no response" } as const;

		expect(activityLine(event, selectStrings("en"))).toBe(
			"2026-10-20 14:30 Disconnecting: the login could not be revoked. Dropbox could not be reached. (no response)",
		);
		expect(activityLine(event, selectStrings("ru"))).toBe(
			"2026-10-20 14:30 Отключение: не удалось отозвать вход. Dropbox недоступен. (no response)",
		);
	});

	it("tells a refused code with the service's answer, and a First sync with the device doing it", () => {
		const refused = { at: AFTERNOON, kind: "connectFailed", cause: "codeRejected", detail: "invalid_grant" } as const;
		const waiting = { at: AFTERNOON, kind: "connectFailed", cause: "firstSyncInProgress", detail: "Tablet" } as const;

		expect(activityLine(refused, selectStrings("en"))).toBe(
			"2026-10-20 14:30 Connecting failed. Dropbox did not accept the code. (invalid_grant)",
		);
		expect(activityLine(waiting, selectStrings("en"))).toBe(
			"2026-10-20 14:30 Connecting failed. Another device is doing its first sync with this folder. (Tablet)",
		);
	});
});
