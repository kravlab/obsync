import type { Strings } from "./strings";

/** Russian UI strings, used when Obsidian's language is Russian. */
export const ru: Strings = {
	statusNotConnected: "Не подключено",
	statusConnected: "Подключено",
	statusSyncing: "Синхронизация…",
	statusSynced: "Синхронизировано",
	statusSyncFailed: "Ошибка синхронизации",

	settingsDropbox: "Dropbox",
	settingsNotConnected: "Это устройство не подключено.",
	settingsConnectedAs: "Подключено как {device}.",
	connect: "Подключить",
	disconnect: "Отключить",
	syncNow: "Синхронизировать сейчас",
	settingsSyncNow: "Выгрузить новые и изменённые файлы этого устройства, затем загрузить файлы других устройств.",
	settingsRequestLimit: "Предел на запрос (МиБ)",
	settingsRequestLimitDescription:
		"Файлы крупнее передаются частями такого размера, от 1 до 19 МиБ. Уменьшите его, если приложение закрывается при синхронизации больших файлов.",
	settingsRequestLimitInvalid: "Введите целое число от 1 до 19.",

	connectTitle: "Подключение к Dropbox",
	loginInstructions: "Откройте Dropbox, разрешите доступ и вставьте код, который покажет Dropbox.",
	openDropbox: "Открыть Dropbox",
	loginCode: "Код",
	continue: "Продолжить",
	codeRejected: "Dropbox не принял этот код: возможно, он уже использован или истёк. Откройте Dropbox ещё раз и вставьте новый код.",
	otherAccount: "Это устройство подключено к другому аккаунту Dropbox. Чтобы сменить аккаунт, сначала отключите его.",
	errorUnreachable: "Dropbox недоступен. Проверьте подключение к сети и попробуйте ещё раз.",
	errorFailed: "Dropbox отклонил запрос. Попробуйте позже.",

	chooseInstructions: "Выберите папку, с которой будет синхронизироваться это хранилище, или создайте новую.",
	folderIsRemote: "Содержит синхронизируемое хранилище.",
	folderIsPlain: "Синхронизируемого хранилища в ней пока нет.",
	noFolders: "Папок пока нет.",
	useFolder: "Выбрать",
	newFolder: "Новая папка",
	create: "Создать",
	folderTaken: "Папка с таким именем уже есть.",
	folderNameInvalid: "В имени папки не может быть «/».",
	providerUnsupported:
		"Этот провайдер не может помешать двум устройствам перезаписать изменения друг друга, поэтому эту папку нельзя синхронизировать.",
	deviceName: "Имя устройства",
	deviceNameDescription: "Под этим именем устройство видят другие устройства: в конфликтах и сообщениях.",

	deviceDesktop: "Компьютер",
	deviceAndroid: "Android",
	deviceIphone: "iPhone",
	deviceIpad: "iPad",

	noticeConnected: "Dropbox подключён.",
	noticeReconnected: "Dropbox подключён заново.",
	noticeDisconnected: "Dropbox отключён.",
	noticeDisconnectedRevokeFailed:
		"Dropbox отключён, но отозвать доступ не удалось: Dropbox недоступен. Удалите приложение из подключённых приложений в настройках Dropbox.",
};
