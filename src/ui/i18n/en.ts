/**
 * English UI strings: the reference set. Every other language must define
 * exactly these keys (see `Strings`). Kept in a file named `en.ts` so the
 * linter's sentence-case rule checks them. A `{name}` in a string is a
 * placeholder that `fill` replaces.
 */
export const en = {
	/** Sync status of a device that has no Connection yet. */
	statusNotConnected: "Not connected",
	/** Sync status of a connected device that has not synced since the plugin started. */
	statusConnected: "Connected",
	/** Sync status while a sync runs. */
	statusSyncing: "Syncing…",
	/** Sync status after a sync finished. */
	statusSynced: "Synced",
	/** Sync status after a sync stopped on a failure. */
	statusSyncFailed: "Sync failed",

	/** Settings row naming the provider the device connects to. */
	settingsDropbox: "Dropbox",
	/** Settings row description while the device is not connected. */
	settingsNotConnected: "This device is not connected.",
	/** Settings row description while connected; `{device}` is the device name. */
	settingsConnectedAs: "Connected as {device}.",
	connect: "Connect",
	disconnect: "Disconnect",
	/** The command and button that sync this device at once. */
	syncNow: "Sync now",
	/** Settings row description of Sync now. */
	settingsSyncNow: "Upload this device's new and changed files, then download those from other devices.",
	/** Settings row of this device's Per-request limit. */
	settingsRequestLimit: "Per-request limit (MiB)",
	/** Settings row description of the Per-request limit. */
	settingsRequestLimitDescription:
		"Larger files move in parts of this size, from 1 to 19 MiB. Lower it if the app closes while syncing large files.",
	/** The typed Per-request limit is not one. */
	settingsRequestLimitInvalid: "Enter a whole number from 1 to 19.",

	/** Title of the connect window. */
	connectTitle: "Connect to Dropbox",
	/** Login step: what to do in the browser. */
	loginInstructions: "Open Dropbox, allow access, then paste the code that Dropbox shows.",
	openDropbox: "Open Dropbox",
	loginCode: "Code",
	continue: "Continue",
	/** The pasted code was refused: reused, expired or mistyped. */
	codeRejected: "Dropbox did not accept this code. It may have been used already or expired. Open Dropbox again and paste the new code.",
	/** A login to a different account than the device's Connection. */
	otherAccount: "This device is connected to a different Dropbox account. Disconnect first to switch accounts.",
	/** Dropbox could not be reached. */
	errorUnreachable: "Dropbox cannot be reached. Check the connection and try again.",
	/** Dropbox refused a request for another reason. */
	errorFailed: "Dropbox refused the request. Try again later.",

	/** Remote step: what to choose. */
	chooseInstructions: "Choose the folder this vault syncs with, or create a new one.",
	/** A folder that already holds a synced vault. */
	folderIsRemote: "Holds a synced vault.",
	/** A folder that does not hold a synced vault yet. */
	folderIsPlain: "Does not hold a synced vault yet.",
	/** Shown when the App Folder has no subfolders. */
	noFolders: "There are no folders yet.",
	useFolder: "Use",
	newFolder: "New folder",
	create: "Create",
	/** Creating a folder whose name is taken. */
	folderTaken: "A folder with this name already exists.",
	/** Creating a folder whose name holds a slash. */
	folderNameInvalid: "A folder name cannot contain \"/\".",
	/** The chosen folder's provider cannot refuse a write over a newer version, so syncing it could lose changes. */
	providerUnsupported:
		"This provider cannot stop two devices from overwriting each other's changes, so this folder cannot be synced.",
	deviceName: "Device name",
	deviceNameDescription: "How other devices name this one, in conflicts and messages.",

	/** Default device names, by platform. */
	deviceDesktop: "Desktop",
	deviceAndroid: "Android",
	deviceIphone: "iPhone",
	deviceIpad: "iPad",

	noticeConnected: "Connected to Dropbox.",
	noticeReconnected: "Reconnected to Dropbox.",
	noticeDisconnected: "Disconnected from Dropbox.",
	/** Disconnected, but the login could not be revoked, e.g. offline. */
	noticeDisconnectedRevokeFailed:
		"Disconnected, but Dropbox could not be reached to revoke access. Remove the app from the connected apps in your Dropbox settings.",
} as const;

/** The shape every language's string table must have: the keys of `en`. */
export type Strings = { readonly [Key in keyof typeof en]: string };
