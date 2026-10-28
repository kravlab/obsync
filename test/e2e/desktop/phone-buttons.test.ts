// Manual check 14 on the desktop, in Obsidian's mobile emulation as a
// phone: every button of the plugin's windows, and of the conflict action
// row, is at least 44 px high. Only what opens without a Dropbox login is
// here: the Sync window, the connect window, the action row and the Edit…
// dialog; the First sync and Deletion guard windows need a connected
// device. The scenarios are the Android run's too (support/page.ts).
import { describePhoneButtons } from "../support/page";
import { useDesktopObsidian } from "../support/desktop-obsidian";

const obsidian = useDesktopObsidian("phone-buttons", { phone: true });

describePhoneButtons(
	"check 14 (partial: no First sync or Deletion guard window): on a phone, every button is at least 44 px high",
	obsidian,
);
