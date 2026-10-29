// The Android run's manual checks, on one phone in the order they need it:
// first what needs no login (checks 3, 14, 17 and 19), with check 3 offline so
// nothing is sent; then the login through Dropbox's authorize page (check 1,
// which also reads the onboarding), the First sync window (check 14), the 50 MB
// file (check 16), and last Disconnect (check 2), which deletes the run's
// Remote folder first. A later check fails when the login it needs failed.
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { useAndroidPhone } from "../support/android-phone";
import {
	authorize,
	disconnectProgram,
	enterCodeProgram,
	leaveDropbox,
	LOGIN_TIMEOUT_MS,
	newFolderProgram,
	openConnectWindowProgram,
} from "../support/dropbox-login";
import { dropboxAppKey, dropboxHelpers } from "../support/dropbox-page";
import {
	CALL_MS,
	describeOnboardingHelp,
	describePhoneButtons,
	expectedOnboarding,
	expectPhoneButtons,
	PAGE_HELPERS,
	TEST_HEADROOM_MS,
	type ButtonsFound,
	type OnboardingFound,
} from "../support/page";

/** The run's Remote folder, in the app folder: named with the run's time, deleted at the end. */
const RUN_FOLDER = `e2e-${new Date().toISOString().replace(/[:.]/g, "-")}`;
/** The vault file of check 16. */
const LARGE_FILE = "large.bin";
/** Its size: 50 MB, as check 16 asks. */
const LARGE_BYTES = 50 * 1024 * 1024;
/** How long uploading it may take: a few minutes on a slow uplink; 15 min only fails a hang. */
const LARGE_TIMEOUT_MS = 900_000;
/** How long a long note's merge may take on the emulator: the Vitest limit (spec, check 17). */
const MERGE_LIMIT_MS = 1000;

const phone = useAndroidPhone({
	// What a failed check leaves goes: the run's Remote folder, then the login, which would stay valid on the device. Through Obsidian, opened again if it died.
	beforeStop: async (device) => {
		if (!(await device.obsidianRuns())) await device.reopen();
		await leaveDropbox(device, RUN_FOLDER, { deleteFolder: true });
	},
});

describe("check 3: Copy error puts the connect window's error on the clipboard", () => {
	it(
		"copies the message and its detail line of a failed connect, with the network off so nothing is sent",
		async () => {
			const strings = await phone().strings();
			// Set once the connect request has failed: before that, turning the network on could still let it out.
			let settled = false;
			try {
				await phone().setNetwork(false);
				const shown = (await phone().eval(`
					${PAGE_HELPERS}
					try {
						${openConnectWindowProgram(strings)}
						${enterCodeProgram("a-code-never-sent", strings)}
						const message = await until(() => [...activeDocument.querySelectorAll(".obsync-message")].find((m) => m.textContent), 30000, "the error message");
						const detail = message.parentElement.querySelector(".obsync-message-detail");
						// Emptied first, so a copy left from before cannot pass.
						await navigator.clipboard.writeText("");
						(await button(${JSON.stringify(strings.copyError)})).click();
						const copied = await until(() => navigator.clipboard.readText(), 10000, "the copied error");
						return { message: message.textContent, detail: detail.textContent, copied };
					} finally {
						await closeModals();
					}`)) as { message: string; detail: string; copied: string };
				settled = true;
				expect(shown.message).toBe(strings.errorUnreachable);
				expect(shown.detail).not.toBe("");
				expect(shown.copied).toBe(`${shown.message}\n${shown.detail}`);
			} finally {
				// Unsettled, the phone stays offline: the checks after this one then fail, and nothing reaches Dropbox.
				if (settled) await phone().setNetwork(true);
			}
		},
		CALL_MS * 3 + TEST_HEADROOM_MS,
	);
});

describePhoneButtons("check 14 (partial: no Deletion guard window): on a phone, every button is at least 44 px high", phone);

describe("check 17: a long note merges within the time limit on the phone", () => {
	it("merges edits at both ends, and nearby edits, of a 20,000-line note within a second", async () => {
		const bundle = await build({
			entryPoints: [fileURLToPath(new URL("../../../src/engine/text-merge.ts", import.meta.url))],
			bundle: true,
			format: "iife",
			globalName: "obsyncMerge",
			platform: "browser",
			write: false,
		});
		const merged = (await phone().eval(`
			${bundle.outputFiles[0]?.text ?? ""}
			const note = Array.from({ length: 20000 }, (_, index) => "line " + index + "\\n");
			const bytes = (lines) => new TextEncoder().encode(lines.join("")).buffer;
			const timed = (local, remote) => {
				const started = performance.now();
				const result = obsyncMerge.mergeText({ base: bytes(note), local: bytes(local), remote: bytes(remote) }, { local: "Phone", remote: "Remote" });
				const ms = performance.now() - started;
				const lines = new TextDecoder().decode(result.data).split("\\n");
				return { ms, conflicted: result.conflicted, lines: lines.length, at: (index) => lines[index] };
			};
			const ends = timed(note.map((line, index) => (index === 10 ? "mine\\n" : line)), note.map((line, index) => (index === 19990 ? "theirs\\n" : line)));
			const near = timed(note.map((line, index) => (index === 10000 ? "mine\\n" : line)), note.map((line, index) => (index === 10050 ? "theirs\\n" : line)));
			return {
				ends: { ms: ends.ms, conflicted: ends.conflicted, mine: ends.at(10), theirs: ends.at(19990) },
				near: { ms: near.ms, conflicted: near.conflicted, mine: near.at(10000), theirs: near.at(10050), lines: near.lines },
			};`)) as Record<"ends" | "near", { ms: number; conflicted: boolean; mine: string; theirs: string; lines?: number }>;
		expect(merged.ends).toMatchObject({ conflicted: false, mine: "mine", theirs: "theirs" });
		expect(merged.near).toMatchObject({ conflicted: false, mine: "mine", theirs: "theirs", lines: 20_001 });
		expect(merged.ends.ms).toBeLessThan(MERGE_LIMIT_MS);
		expect(merged.near.ms).toBeLessThan(MERGE_LIMIT_MS);
	});
});

describeOnboardingHelp("check 19 (partial: no settings row): onboarding and help, in English and Russian", phone, { settingsRow: false });

describe("check 1: connecting through the phone's real requestUrl", () => {
	it(
		"logs in through Dropbox's authorize page and connects to a new Remote folder",
		async () => {
			const strings = await phone().strings();
			await phone().closeBrowser();
			await phone().eval(`
				${PAGE_HELPERS}
				${openConnectWindowProgram(strings)}
				(await button(${JSON.stringify(strings.openDropbox)})).click();`);
			const code = await authorize(phone());
			await phone().showObsidian();
			const connected = (await phone().eval(
				`
				${PAGE_HELPERS}
				${enterCodeProgram(code, strings)}
				${newFolderProgram(RUN_FOLDER, strings)}
				const notice = await until(() => [...activeDocument.querySelectorAll(".notice")].find((n) => n.textContent === ${JSON.stringify(strings.noticeConnected)}), 60000, "the Connected notice");
				// A new Connection shows the onboarding, read before it is closed; the first sync starts once it is closed.
				const onboarding = await onboardingWindow(${JSON.stringify(strings.onboardingDone)});
				const read = readOnboarding(onboarding);
				(await button(${JSON.stringify(strings.onboardingDone)}, onboarding)).click();
				return { notice: notice.textContent, onboarding: read };`,
				LOGIN_TIMEOUT_MS,
			)) as { notice: string; onboarding: OnboardingFound };
			expect(connected.notice).toBe(strings.noticeConnected);
			expect(connected.onboarding).toEqual(expectedOnboarding(strings));
		},
		CALL_MS * 2 + LOGIN_TIMEOUT_MS * 2 + TEST_HEADROOM_MS,
	);
});

describe("check 14 (partial: no Deletion guard window): on a phone, every button is at least 44 px high", () => {
	it(
		"in the First sync window, which then starts the first sync",
		async () => {
			const strings = await phone().strings();
			const found = (await phone().eval(
				`
				${PAGE_HELPERS}
				const firstSync = await until(() => [...activeDocument.querySelectorAll(".modal")].find((m) => m.querySelector(".modal-title")?.textContent === ${JSON.stringify(strings.firstSyncTitle)}), 60000, "the First sync window");
				const result = { phone: firstSync.classList.contains("obsync-phone"), buttons: buttons(firstSync) };
				(await button(${JSON.stringify(strings.firstSyncStart)}, firstSync)).click();
				await until(() => activeDocument.querySelector("[aria-label=" + JSON.stringify(${JSON.stringify(strings.statusSynced)}) + "]"), 60000, "the Synced status");
				return result;`,
				120_000,
			)) as ButtonsFound;
			expectPhoneButtons(found);
		},
		CALL_MS + 120_000 + TEST_HEADROOM_MS,
	);
});

describe("check 16: a 50 MB attachment goes up and comes back intact", () => {
	it(
		"uploads it, downloads it back through requestUrl with the same SHA-256, and Obsidian keeps running",
		async () => {
			const strings = await phone().strings();
			const result = (await phone().eval(
				`
				${dropboxHelpers(dropboxAppKey())}
				// Bytes no compression shrinks, the same every run (xorshift32 from a fixed seed).
				const data = new Uint8Array(${LARGE_BYTES});
				let state = 0x2545f491;
				for (let index = 0; index < data.length; index++) {
					state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
					data[index] = state & 0xff;
				}
				const sent = await sha256(data.buffer);
				await app.vault.createBinary(${JSON.stringify(LARGE_FILE)}, data.buffer);
				app.commands.executeCommandById("obsync:sync-now");
				const access = await dropboxAccess(pluginSecret());
				if (!access.token) throw new Error("no access token: HTTP " + access.status);
				const synced = () => activeDocument.querySelector("[aria-label=" + JSON.stringify(${JSON.stringify(strings.statusSynced)}) + "]") !== null;
				// Dropbox is asked only while the plugin shows Synced. The run's folder is listed, not the file looked up: the
				// folder is there from the start, so no ask is answered 409 for a file not uploaded yet.
				const uploaded = await askDropbox(async () => {
					if (!synced()) return null;
					const listed = await dropboxCall(access.token, "files/list_folder", { path: ${JSON.stringify(`/${RUN_FOLDER}`)} });
					const file = listed.json?.entries.find((entry) => entry.name === ${JSON.stringify(LARGE_FILE)} && entry.size === ${LARGE_BYTES});
					return { status: listed.status, done: file !== undefined, value: file };
				}, ${LARGE_TIMEOUT_MS}, "the file");
				// The revision just checked, so the parts cannot mix two versions.
				const back = await dropboxDownload(access.token, "rev:" + uploaded.rev, uploaded.size);
				return { sent, back: await sha256(back), size: back.byteLength, uploadedSize: uploaded.size };`,
				LARGE_TIMEOUT_MS + 120_000,
			)) as { sent: string; back: string; size: number; uploadedSize: number };
			expect(result.uploadedSize).toBe(LARGE_BYTES);
			expect(result.size).toBe(LARGE_BYTES);
			expect(result.back).toBe(result.sent);
			expect(await phone().obsidianRuns()).toBe(true);
			expect(await phone().eval("return 1 + 1;")).toBe(2);
		},
		CALL_MS * 2 + LARGE_TIMEOUT_MS + 120_000 + TEST_HEADROOM_MS,
	);
});

describe("check 2: Disconnect ends without an error and the login no longer works", () => {
	it(
		"disconnects, then Dropbox refuses the old login once",
		async () => {
			const strings = await phone().strings();
			const result = (await phone().eval(`
				${PAGE_HELPERS}
				${dropboxHelpers(dropboxAppKey())}
				const secret = pluginSecret();
				if (!secret) throw new Error("the plugin is not connected");
				const access = await dropboxAccess(secret);
				if (!access.token) throw new Error("no access token: HTTP " + access.status);
				// The run's Remote folder goes while the login still works, right before Disconnect: a poll (every
				// 60 s) landing in between would sync against a Remote without it. Turning the plugin off meanwhile
				// is no way out, as turning it on again starts a sync at once.
				const deleted = await dropboxCall(access.token, "files/delete_v2", { path: ${JSON.stringify(`/${RUN_FOLDER}`)} });
				${disconnectProgram(strings)}
				// The one request expected to be refused (plan, step 14): the old login, after Disconnect revoked it.
				const refused = await dropboxAccess(secret);
				return { deleted: deleted.status, notice, secretLeft: pluginSecret() !== null, refused: { status: refused.status, error: refused.error } };`)) as {
				deleted: number;
				notice: string;
				secretLeft: boolean;
				refused: { status: number; error: unknown };
			};
			expect(result.deleted).toBe(200);
			expect(result.notice).toBe(strings.noticeDisconnected);
			expect(result.secretLeft).toBe(false);
			expect(result.refused).toEqual({ status: 400, error: "invalid_grant" });
		},
		CALL_MS * 2 + TEST_HEADROOM_MS,
	);
});
