/**
 * English UI strings: the reference set. Every other language must define
 * exactly these keys (see `Strings`). Kept in a file named `en.ts` so the
 * linter's sentence-case rule checks them. A `{name}` in a string is a
 * placeholder that `fill` replaces.
 */
export const en = {
	/** Sync status of a device that has no Connection yet. */
	statusNotConnected: "Not connected",
	/** Sync status of a device that has a Connection, before syncing exists. */
	statusConnected: "Connected",

	/** Settings row naming the provider the device connects to. */
	settingsDropbox: "Dropbox",
	/** Settings row description while the device is not connected. */
	settingsNotConnected: "This device is not connected.",
	/** Settings row description while connected; `{device}` is the device name. */
	settingsConnectedAs: "Connected as {device}.",
	connect: "Connect",
	disconnect: "Disconnect",

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
