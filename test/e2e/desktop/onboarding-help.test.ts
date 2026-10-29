// Manual check 19 on the desktop: the help and the onboarding show the
// strings of the language Obsidian is set to, English then Russian (the
// scenario itself is in test/e2e/support/page.ts, shared with the Android
// run). The "Show help" command and the settings row "Open help" both open
// the Sync window at the Help tab; "Show the four habits again" opens the
// onboarding, and "Got it" closes it. Obsidian runs with no network, as every
// desktop scenario that needs no login does.
import { useDesktopObsidian } from "../support/desktop-obsidian";
import { describeOnboardingHelp } from "../support/page";

const obsidian = useDesktopObsidian("onboarding-help");

describeOnboardingHelp("check 19: onboarding and help, in English and Russian", obsidian, { settingsRow: true });
