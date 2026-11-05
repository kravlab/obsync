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
	/** Sync status while sync is paused on this device until the user logs in again. */
	statusReconnectNeeded: "Reconnect needed",
	/** Sync status after the Deletion guard prompt was closed without a choice; sync waits for "Sync now". */
	statusDeletionsOnHold: "Paused (confirm deletions)",
	/** Sync status after the First sync preview was closed without starting; sync waits for "Sync now". */
	statusFirstSyncWaiting: "First sync waiting for you",
	/** Sync status after the shared settings collision prompt was closed without a choice; sync waits for "Sync now". */
	statusSettingsCollision: "Paused (choose shared settings)",

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
	/** Settings button renaming this device. */
	rename: "Rename",
	/** The typed device name is blank. */
	deviceNameInvalid: "Enter a name.",
	/** Settings heading of the shared Remote settings, the same on every device. */
	settingsSharedHeading: "All devices",
	/** Shown instead of the shared settings before this device synced once. */
	settingsSharedUnknown: "Sync this device once to see the shared settings.",
	/** Settings row of the name policy. */
	settingsNamePolicy: "Names Dropbox cannot store",
	settingsNamePolicyDescription:
		"Skip such files and list them, or store them under names with look-alike characters. It changes only while Dropbox holds no file it would name differently.",
	/** The name policy's choices. */
	namePolicySkip: "Skip and list them",
	namePolicyEncode: "Encode them reversibly",
	/** Settings row of the text-extension list. */
	settingsTextExtensions: "Text files",
	settingsTextExtensionsDescription:
		"Extensions of files merged line by line, separated by commas. Other changed files get conflict copies.",
	/** Settings row of the ignore list. */
	settingsIgnoreList: "Ignore list",
	settingsIgnoreListDescription: "Paths that never sync, one pattern per line, as in a .gitignore file.",
	/** Settings row of the size ceiling. */
	settingsSizeCeiling: "Size limit (MiB)",
	settingsSizeCeilingDescription: "Larger files are skipped and listed.",
	/** The typed size ceiling is not one. */
	settingsSizeCeilingInvalid: "Enter a whole number, at least 1.",
	/** Settings button writing the shared settings for every device. */
	settingsApplyShared: "Apply to all devices",
	settingsApplySharedDescription: "These settings are the same on every device. Applying them writes them to Dropbox and syncs.",
	/** Settings heading of the other devices on the Remote. */
	settingsDevicesHeading: "Other devices",
	/** Settings row description of another device, the row named after it. */
	settingsDeviceDescription: "Forget a device only when it will never sync again.",
	/** Settings button reading the other devices from Dropbox, which lists all of it. */
	showDevices: "Show devices",
	/** Shown when no other device is registered. */
	settingsNoOtherDevices: "No other devices are registered.",
	/** Shown when the other devices could not be read. */
	settingsDevicesUnavailable: "The devices could not be read from Dropbox.",
	/** Button forgetting another device. */
	forgetDevice: "Forget",
	/** Title of the confirmation; `{device}` is the device's name. */
	forgetDeviceTitle: "Forget {device}?",
	forgetDeviceText: "Its record is removed from Dropbox. Do this only for a device that will never sync again.",
	/** After forgetting; `{device}` is its name. */
	noticeDeviceForgotten: "{device} is forgotten.",
	/** The device rewrote its record meanwhile, so it is still in use; `{device}` is its name. */
	noticeDeviceInUse: "{device} synced in the meantime, so it was not forgotten.",
	/** Forgetting failed, e.g. offline. */
	noticeForgetFailed: "The device could not be forgotten. Try again later.",
	/** Renaming this device failed unexpectedly, a bug. */
	noticeRenameFailed: "The device could not be renamed: the plugin hit an error. See the console.",
	/** Applying the shared settings failed unexpectedly, a bug. */
	noticeApplyFailed: "The shared settings could not be applied: the plugin hit an error. See the console.",
	/** Title of the shared settings collision prompt. */
	collisionTitle: "Shared settings differ",
	collisionIntro: "Another device changed these shared settings at the same time. Choose the value each one keeps.",
	/** A choice in the collision prompt; `{value}` is the setting's value as text. */
	collisionMine: "This device: {value}",
	collisionRemote: "Other device: {value}",
	/** Button applying the choices. */
	collisionApply: "Apply",
	/** What closing the prompt does. */
	collisionCloseHint: "Closing this window pauses sync until you start a sync yourself.",
	/** An empty list as a setting's value. */
	settingValueNone: "None",
	/** A size as a setting's value; `{count}` is a number. */
	settingValueMebibytes: "{count} MiB",

	/** Title of the First sync preview. */
	firstSyncTitle: "First sync",
	/** What the First sync preview is about. */
	firstSyncIntro:
		"This device has not synced with Dropbox yet. Here is what the first sync will do; nothing changes until you start it, and it deletes nothing.",
	/** First sync preview: files only Dropbox has; `{count}` is a number. */
	firstSyncToDownload: "To download from Dropbox: {count}",
	/** First sync preview: files only this device has. */
	firstSyncToUpload: "To upload to Dropbox: {count}",
	/** First sync preview: files with the same content on both sides. */
	firstSyncIdentical: "Already the same on both: {count}",
	/** First sync preview: files with different content on the two sides. */
	firstSyncDiffering: "Different on both: {count}",
	/** First sync preview list: what happens to a differing text file. */
	firstSyncMerged: "Merged, every difference marked",
	/** First sync preview list: what happens to any other differing file. */
	firstSyncConflictCopy: "This device's version kept as a conflict copy",
	/** First sync preview list: what happens to a differing JSON file, merged only when the merge is clean and parses. */
	firstSyncMergedOrConflictCopy: "Merged, or this device's version kept as a conflict copy if it cannot be merged",
	/** First sync preview list: what happens to a differing configuration file. */
	firstSyncRemoteKept: "Dropbox version used, this device's kept to restore",
	/** First sync preview list: one differing file; `{path}` is its vault path, `{outcome}` one of the texts above. */
	firstSyncDifferingFile: "{path}: {outcome}",
	/** First sync preview: the bulk option for differing files. */
	firstSyncKeepRemote: "Use the Dropbox version of every differing file",
	/** First sync preview: what the bulk option does. */
	firstSyncKeepRemoteDescription: "This device's versions are kept as conflict copies, so no note gets conflict markers.",
	/** First sync preview: shows the list of files. */
	firstSyncShowList: "Show list",
	/** First sync preview: hides the list of files. */
	firstSyncHideList: "Hide list",
	/** First sync preview: starts the sync. */
	firstSyncStart: "Start first sync",
	/** First sync preview: what closing it does. */
	firstSyncCloseHint: "Closing this window pauses sync until you start a sync yourself.",
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
	codeRejected:
		"Dropbox did not accept this code. It may have been used already or expired. Open Dropbox again and paste the new code.",
	/** A login to a different account than the device's Connection. */
	otherAccount: "This device is connected to a different Dropbox account. Disconnect first to switch accounts.",
	/** Dropbox could not be reached. */
	errorUnreachable: "Dropbox cannot be reached. Check the connection and try again.",
	/** Dropbox refused a request for another reason. */
	errorFailed: "Dropbox refused the request. Try again later.",
	/** Connecting failed on an error the plugin did not expect, a bug. */
	connectUnexpected: "Connecting failed unexpectedly.",
	/** Under a failure's message: what went wrong, `{detail}`, untranslated: Dropbox's answer, or an error's name and message. */
	errorDetails: "Details: {detail}",
	/** The connect window's button copying the failure shown. */
	copyError: "Copy error",
	/** Notice after the failure was copied. */
	errorCopied: "The error is copied.",
	/** Notice when the clipboard refused the failure. */
	errorNotCopied: "The error could not be copied. Select it and copy it by hand.",

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
	folderNameInvalid: 'A folder name cannot contain "/".',
	/** The chosen folder's provider cannot refuse a write over a newer version, so syncing it could lose changes. */
	providerUnsupported: "This provider cannot stop two devices from overwriting each other's changes, so this folder cannot be synced.",
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
	/** Disconnecting stopped on an error the plugin did not expect, a bug. */
	noticeDisconnectFailed: "Disconnecting failed: the plugin hit an error. See the console.",
	/** Disconnected, but the login could not be revoked, e.g. offline; the activity log tells why. */
	noticeDisconnectedRevokeFailed:
		"Disconnected, but Dropbox did not revoke access. Remove the app from the connected apps in your Dropbox settings.",
	/** A file changed on two devices could not be merged; `{file}` and `{copy}` are vault paths. */
	noticeConflictCopyCreated: "{file} changed on another device too and could not be merged. This device's version is kept as {copy}.",
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
	/** A First sync completed; every placeholder is a number. */
	noticeFirstSyncDone:
		"First sync done: {downloaded} downloaded, {uploaded} uploaded, {conflicted} with conflicts to resolve, {copies} conflict copies.",
	/** Configuration files arrived from another device; Obsidian applies them on restart. */
	noticeConfigurationChanged: "Settings changed on another device. Restart Obsidian to apply them.",
	/** Dropbox refused this device's login, so sync is paused on it until the user reconnects. */
	noticeReconnectNeeded: "Dropbox no longer accepts this device's login, so sync is paused here. Open the sync window and reconnect.",
	/** The name policy was not changed, since Dropbox holds files it would name differently; `{files}` lists their vault paths. */
	noticeNamePolicyRefused:
		"The name policy was not changed: these files in Dropbox would get names it cannot keep. Rename them first: {files}.",
	/** Connect window: another device is doing its First sync with the chosen folder; `{device}` is its name. */
	firstSyncInProgress: "{device} is doing its first sync with this folder. Connect once it has finished, so fewer files conflict.",
	/** Connect window: connects although another device's First sync is in progress. */
	connectAnyway: "Connect anyway",

	/** After the sync status: how many files the last sync left out; `{count}` is a number. */
	skippedCount: "{count} skipped",
	/** After the sync status: how many conflicts are left; `{count}` is a number, so the wording does not depend on it. */
	conflictsCount: "{count} in conflict",
	/** The sync status with one count after it; `{status}` and `{count}` are the two texts. */
	statusWithCount: "{status} · {count}",
	/** One skipped file in the status notice, by why it does not sync; `{file}` is a vault path. */
	skippedIgnored: "{file} matches the ignore list",
	skippedNameNotRepresentable: "{file} has a name the cloud cannot store",
	skippedCaseClash: "{file} differs from another file's name only in case",
	skippedTooLarge: "{file} is larger than the size limit",
	/** The last line of a shortened skipped list; `{count}` is how many files it leaves out. */
	skippedMore: "And {count} more",
	/** The command that restores a local configuration version kept on a configuration conflict. */
	restoreConfiguration: "Restore local configuration",
	/** The restore list's entry for a kept version; `{file}` is a vault path, `{time}` the local date and time. */
	keptConfigurationItem: "{file}, kept {time}",
	/** The restore list's placeholder. */
	restoreConfigurationPlaceholder: "Choose the version to put back",
	/** Notice when the restore command finds no kept version. */
	noKeptConfiguration: "No local configuration versions are kept.",
	/** Settings heading of the configuration categories. */
	settingsConfigurationHeading: "Configuration folder",
	/** Settings: the settings and hotkeys category. */
	settingsCategorySettings: "Sync settings and hotkeys",
	settingsCategorySettingsDescription:
		"This device's main settings, hotkeys and core plugin settings. The workspace layout never syncs. Settings that arrive apply after a restart.",
	/** Settings: the themes and snippets category. */
	settingsCategoryThemes: "Sync themes and snippets",
	settingsCategoryThemesDescription: "Themes, CSS snippets and the appearance settings that choose them.",
	/** Settings: the plugins category, with the secrets warning. */
	settingsCategoryPlugins: "Sync plugins",
	settingsCategoryPluginsDescription:
		"Other plugins with their settings and the list of enabled plugins. Warning: other plugins' settings may hold secrets such as API keys or passwords, and they are copied to Dropbox.",

	/** Title of the Sync window. */
	syncWindowTitle: "Sync",
	/** The command opening the Sync window. */
	openSyncWindow: "Open sync window",
	/** The commands opening the Sync window at one of its tabs. */
	showConflicts: "Show conflicts",
	showSkipped: "Show skipped files",
	showActivity: "Show activity",
	/** The Sync window's button while sync is paused for a new login. */
	reconnect: "Reconnect",
	/** The command logging in again while sync is paused for it. */
	reconnectCommand: "Reconnect to Dropbox",
	/** The Sync window's tabs; `{count}` is a number. */
	tabConflicts: "Conflicts ({count})",
	tabSkipped: "Skipped ({count})",
	tabActivity: "Activity",
	/** Conflicts tab: the files holding Conflict blocks. */
	conflictedFiles: "Files with conflicts",
	/** Conflicts tab: the Conflict copies. */
	conflictCopies: "Conflict copies",
	/** Conflicts tab: this device's configuration versions kept on configuration conflicts. */
	keptConfigurations: "Configuration kept from this device",
	/** Conflicts tab: the button putting a kept configuration version back. */
	restoreLocal: "Restore local",
	/** Conflicts tab when nothing is in conflict. */
	nothingInConflict: "Nothing is in conflict.",
	/** Skipped tab when no file is skipped. */
	nothingSkipped: "No files are skipped.",
	/** Activity tab when nothing was recorded. */
	nothingRecorded: "No activity is recorded yet.",
	/** Activity tab: the button copying the bug report. */
	copyBugReport: "Copy for a bug report",
	/** Activity tab: what the bug report holds. */
	copyBugReportHint: "The report lists the events below, with the names of files in this vault.",
	/** Notice after the bug report was copied. */
	bugReportCopied: "The bug report is copied.",
	/** Notice when the clipboard refused the bug report. */
	bugReportNotCopied: "The bug report could not be copied.",
	/** Notice when a listed file is gone; `{file}` is a vault path. */
	fileGone: "{file} is no longer in this vault.",

	/** One event of the activity log; `{time}` is the local date and time, `{text}` what happened. */
	activityLine: "{time} {text}",
	/** A failed sync in the activity log; `{cause}` is one of the failure texts below, a sentence without its full stop. */
	activitySyncFailed: "Sync failed. {cause}.",
	/** A failure while connecting in the activity log; `{cause}` is a failure text below, of a sync or a `connectFailure` one. */
	activityConnectFailed: "Connecting failed. {cause}.",
	/** Disconnecting could not revoke the login, which may still work at Dropbox; `{cause}` is a failure text below. */
	activityRevokeFailed: "Disconnecting: the login could not be revoked. {cause}.",
	/**
	 * A failure's line with its detail; `{text}` is the line, `{detail}`, untranslated, what tells more:
	 * Dropbox's answer, an error's name and message, or the name of the device doing its first sync.
	 */
	activityDetail: "{text} ({detail})",
	/** Why a provider call or a sync failed, by cause. */
	failureAuth: "Dropbox refused the login",
	failureThrottled: "Dropbox asked to slow down",
	failureTransient: "Dropbox could not be reached",
	failureNotFound: "A file was not found in Dropbox",
	failurePreconditionFailed: "A file changed in Dropbox during the sync",
	failureCursorLost: "Dropbox reset its list of changes",
	failureQuotaExceeded: "Dropbox is full",
	failureTooLarge: "A file is too large for Dropbox",
	failureNameNotRepresentable: "Dropbox cannot store a file name",
	failurePermanent: "Dropbox refused a request",
	failureUnsupportedProvider: "This provider cannot be synced",
	failureUnreadableSettings: "The shared settings in Dropbox are missing or unreadable",
	failureBug: "The plugin hit an error",
	/** Why connecting failed, for the refusals that are not a provider failure. */
	connectFailureCodeRejected: "Dropbox did not accept the code",
	connectFailureOtherAccount: "This device is connected to a different Dropbox account",
	connectFailureNameTaken: "A folder with this name already exists",
	connectFailureInvalidName: 'The folder name contains "/"',
	connectFailureFirstSyncInProgress: "Another device is doing its first sync with this folder",
	/** Title of the onboarding window shown after a new connection. */
	onboardingTitle: "Before you sync",
	/** What the onboarding's list is. */
	onboardingIntro: "Four habits keep most conflicts away:",
	/** The four practices, in the onboarding and in help. */
	practiceOneDeviceFirst: "Set up one device first, and let it finish its first sync.",
	practiceEmptyOrCurrent: "Connect each new device with an empty vault or one that is up to date.",
	practiceWaitForSynced: "Wait until the status says synced before closing Obsidian or going offline.",
	practiceSyncAfterOffline: "After being offline, sync before editing notes that changed on another device.",
	/** Button closing the onboarding. */
	onboardingDone: "Got it",
	/** Help: the button opening the onboarding again. */
	showOnboarding: "Show the four habits again",
	/** Help sections, each a heading and its text. */
	helpPracticesHeading: "Avoiding conflicts",
	helpConflictsHeading: "Conflicts",
	helpConflictBlocks:
		"When two devices change the same lines of a note, both versions stay in the note as a conflict, marked with this device's name on one side and as the remote version on the other. Choose a version, keep both, or edit the text by hand with the buttons above the conflict.",
	helpConflictCopies:
		"A changed file that cannot be merged, such as an image or a JSON file whose edits clash, takes the other device's version, and this device's version is kept beside it as a conflict copy. Compare the two, keep what you need in the original, then delete the copy.",
	helpOutsideHeading: "Edits outside Obsidian",
	helpOutsideEdits:
		"Changes made to the synced folder in Dropbox itself, for example on its website, are picked up like any other change where possible, but only on a best-effort basis.",
	/** `{folder}` is the name of the plugin's own folder in Dropbox. */
	helpMetadataFolder: "Never change or delete the {folder} folder in Dropbox: it holds the plugin's own data for every device.",
	helpConfigurationHeading: "Configuration folder",
	helpConfigurationCategories:
		"Each device chooses which parts of its configuration folder sync: settings and hotkeys, themes and snippets, and plugins.",
	helpConfigurationSecrets:
		"Other plugins' settings may hold secrets such as API keys or passwords; syncing plugins copies them to Dropbox.",
	helpConfigurationRestart:
		"Settings that arrive from another device apply after Obsidian restarts. When both devices changed the same file, changes that do not overlap are merged; otherwise the Dropbox version is used and this device's is kept, to restore from the conflicts list.",
	helpSkippedHeading: "Skipped files",
	/** Help: what never syncs and is not listed as skipped. */
	helpNeverSynced: "Files and folders whose names start with a dot, and this device's workspace layout, never sync.",
	helpSkipped:
		"Other files are skipped while one of these holds, and the skipped list in the sync window names each one with its reason:",
	/** Help: the reasons a file is skipped. */
	helpSkippedIgnored: "It matches the ignore list.",
	helpSkippedName: "Its name cannot be stored in Dropbox.",
	helpSkippedCase: "Its name differs from another file's only in letter case.",
	helpSkippedSize: "It is larger than the size limit.",
	/** Settings row opening help. */
	settingsHelp: "Help",
	settingsHelpDescription: "How to avoid conflicts, and what the plugin does with them.",
	/** Settings button opening help. */
	openHelp: "Open help",
	/** The command opening the Sync window at its Help tab. */
	showHelp: "Show help",
	/** The Sync window's Help tab. */
	tabHelp: "Help",
	/** The bug report's lines, always taken from this English table; `{version}`, `{platform}`, `{status}` are filled in. */
	bugReportTitle: "Seamsync bug report",
	bugReportPluginVersion: "Plugin version: {version}",
	bugReportObsidianVersion: "Obsidian version: {version}",
	bugReportPlatform: "Platform: {platform}",
	bugReportStatus: "Status: {status}",
	bugReportActivity: "Activity, newest first:",
	bugReportNoActivity: "No activity recorded.",
} as const;

/** The shape every language's string table must have: the keys of `en`. */
export type Strings = { readonly [Key in keyof typeof en]: string };
