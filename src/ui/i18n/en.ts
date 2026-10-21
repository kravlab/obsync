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
	/** Sync status when the Remote could not be reached; sync retries on its own. */
	statusOffline: "Offline",
	/** Sync status after a sync stopped on a failure. */
	statusSyncFailed: "Sync failed",
	/** Sync status after the Deletion guard prompt was closed without a choice; sync waits for "Sync now". */
	statusDeletionsOnHold: "Deletions waiting for you",

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
	/** The command that lists the whole Remote instead of using the change feed. */
	fullReconcile: "Full reconcile",

	/** Conflict block action keeping one side; `{label}` is the name in its marker. */
	conflictKeep: "Keep {label}",
	/** Conflict block action keeping the first side, whose marker has no name. */
	conflictKeepFirst: "Keep first version",
	/** Conflict block action keeping the second side, whose marker has no name. */
	conflictKeepSecond: "Keep second version",
	/** Name of a Conflict block's first side when its marker has none. */
	conflictFirstVersion: "First version",
	/** Name of a Conflict block's second side when its marker has none. */
	conflictSecondVersion: "Second version",
	/** Conflict block action keeping both sides in order. */
	conflictKeepBoth: "Keep both",
	/** Conflict block action opening the hand-edit dialog. */
	conflictEdit: "Edit…",
	/** Title of the hand-edit dialog. */
	conflictEditTitle: "Resolve conflict",
	/** What the hand-edit dialog's text field is for. */
	conflictEditDescription: "Combine the two versions here; saving replaces the whole conflict with this text.",
	/** Button saving the hand edit. */
	save: "Save",
	/** Button closing the hand-edit dialog without a change. */
	cancel: "Cancel",
	/** Notice when the conflict changed while the hand-edit dialog was open; the dialog stays open. */
	conflictChanged: "This conflict changed in the meantime. Copy your text, close this window and try again.",
	/** Heading of a Conflict block in reading view. */
	conflictUnresolved: "Unresolved conflict",
	/** Reading view hint below the heading. */
	conflictUnresolvedHint: "Switch to editing view to resolve it.",
	/** Command moving to the next Conflict block. */
	nextConflict: "Next conflict",
	/** Command moving to the previous Conflict block. */
	previousConflict: "Previous conflict",
	/** Notice when the note has no Conflict blocks. */
	noConflicts: "This note has no conflicts.",
	/** Settings row description of Sync now. */
	settingsSyncNow: "Upload this device's new and changed files, then download those from other devices.",
	/** Settings row of this device's post-edit pause. */
	settingsEditPause: "Post-edit pause (seconds)",
	/** Settings row description of the post-edit pause. */
	settingsEditPauseDescription: "How long to wait after an edit before syncing, from 1 to 60 seconds.",
	/** The typed post-edit pause is not one. */
	settingsEditPauseInvalid: "Enter a whole number from 1 to 60.",
	/** Settings row of this device's polling interval. */
	settingsPollInterval: "Polling interval (seconds)",
	/** Settings row description of the polling interval. */
	settingsPollIntervalDescription: "How often to check for changes from other devices, from 10 to 3600 seconds.",
	/** The typed polling interval is not one. */
	settingsPollIntervalInvalid: "Enter a whole number from 10 to 3600.",
	/** Settings row of this device's Per-request limit. */
	settingsRequestLimit: "Per-request limit (MiB)",
	/** Settings row description of the Per-request limit. */
	settingsRequestLimitDescription:
		"Larger files move in parts of this size, from 1 to 19 MiB. Lower it if the app closes while syncing large files.",
	/** The typed Per-request limit is not one. */
	settingsRequestLimitInvalid: "Enter a whole number from 1 to 19.",
	/** Settings row of this device's Deletion guard file count N. */
	settingsGuardFiles: "Deletion guard: files",
	/** Settings row description of the Deletion guard file count. */
	settingsGuardFilesDescription: "Ask before a sync deletes more than this many files on one side, from 1 to 100000.",
	/** The typed Deletion guard file count is not one. */
	settingsGuardFilesInvalid: "Enter a whole number from 1 to 100000.",
	/** Settings row of this device's Deletion guard percentage P. */
	settingsGuardPercent: "Deletion guard: percent",
	/** Settings row description of the Deletion guard percentage. */
	settingsGuardPercentDescription:
		"Ask before a sync deletes more than this share of the synced files on one side, from 1 to 100 percent.",
	/** The typed Deletion guard percentage is not one. */
	settingsGuardPercentInvalid: "Enter a whole number from 1 to 100.",

	/** Title of the Deletion guard prompt. */
	guardTitle: "Confirm deletions",
	/** Why the guard stopped: more deletions than N or P allow. */
	guardReasonThreshold: "This sync would delete more files than the deletion guard allows.",
	/** Why the guard stopped: the vault lost every synced file. */
	guardReasonMissingVault: "This vault has none of its synced files left.",
	/** Why the guard stopped: Dropbox lost every synced file. */
	guardReasonEmptyRemote: "Dropbox has none of the synced files left.",
	/** How many files deleted here would be deleted in Dropbox; `{count}` is a number. */
	guardToRemote: "Deleted on this device, to delete in Dropbox: {count}",
	/** How many files deleted elsewhere would go to this device's trash; `{count}` is a number. */
	guardToVault: "Deleted on another device, to move to this device's trash: {count}",
	/** What closing the prompt does. */
	guardCloseHint: "Closing this window pauses sync until you start a sync yourself.",
	/** Button showing every file in the prompt. */
	guardReview: "Review list",
	/** Button hiding the list again. */
	guardHideList: "Hide list",
	/** Button applying the deletions. */
	guardApply: "Apply deletions",
	/** Button bringing every file back to the side it was deleted from. */
	guardRestore: "Restore files",

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
	/** A file changed on two devices could not be merged; `{file}` and `{copy}` are vault paths. */
	noticeConflictCopyCreated:
		"{file} changed on another device too and could not be merged. This device's version is kept as {copy}.",
	/** A file deleted on this device came back, since another device had edited it; `{file}` is a vault path. */
	noticeRestoredDeletedHere: "{file} came back: it was deleted on this device but edited on another one.",
	/** A file edited on this device was kept and uploaded again, though another device deleted it; `{file}` is a vault path. */
	noticeRestoredDeletedThere: "{file} was kept: it was deleted on another device but edited on this one.",
	/** A file this device renamed to `{local}` took the name `{file}` another device gave it; both are vault paths. */
	noticeRenamedOnBoth: "{local} was renamed differently on another device and is now {file}.",
	/** A file deleted on this device came back under the name another device gave it; `{file}` is a vault path. */
	noticeRenamedDeletedHere: "{file} came back: it was deleted on this device but renamed on another one.",
	/** A file renamed on this device was kept, though another device deleted it; `{file}` is a vault path. */
	noticeRenamedDeletedThere: "{file} was kept: it was deleted on another device but renamed on this one.",
} as const;

/** The shape every language's string table must have: the keys of `en`. */
export type Strings = { readonly [Key in keyof typeof en]: string };
