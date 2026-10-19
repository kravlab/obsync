import { describe, expect, it } from "vitest";
import type { ConnectStep } from "../../src/engine/connect-step";
import { bytes } from "../support/bytes";
import { expectFailure } from "../support/provider-failure";

/**
 * A provider's connect step together with the controls a test needs to
 * play the user and the service around it.
 */
export interface ConnectStepHarness {
	/** The connect step under test, as one device sees it. */
	readonly connectStep: ConnectStep;
	/** The account `approve` logs in to. */
	readonly accountId: string;
	/**
	 * Plays the user approving the plugin on the authorize page at
	 * `authorizeUrl`, and returns the code the page shows.
	 */
	approve(authorizeUrl: string): Promise<string>;
	/** A second account at the same service, holding no folders. */
	readonly otherAccountId: string;
	/** Like `approve`, with the user signed in to the other account. */
	approveAsOther(authorizeUrl: string): Promise<string>;
	/**
	 * Puts a folder named `name` where Remote roots live, holding an empty
	 * folder for each name in `children`.
	 */
	addFolder(name: string, children?: readonly string[]): Promise<void>;
	/** Makes every access token issued so far expire at the service. */
	expireAccessTokens(): void;
}

/**
 * The connect-step part of the Provider contract suite (spec, "Testing
 * Decisions", seam 2): login and the code exchange, the account id of each
 * account, choosing and setting up a Remote root, refresh and revoke. It
 * reaches the provider only through the ConnectStep interface.
 *
 * @param name the provider under test, shown in test names
 * @param createHarness returns a harness on a new account with no folders
 */
export function describeConnectStepContract(
	name: string,
	createHarness: () => Promise<ConnectStepHarness>,
): void {
	/** Logs in through `harness` and returns the secret. */
	async function logIn(harness: ConnectStepHarness): Promise<string> {
		const attempt = await harness.connectStep.startAuthorization();
		const code = await harness.approve(attempt.authorizeUrl);
		return (await attempt.complete(code)).secret;
	}

	describe(`Connect step contract: ${name}`, () => {
		it("logs in with the code the authorize page shows, yielding the account and a secret", async () => {
			const harness = await createHarness();
			const attempt = await harness.connectStep.startAuthorization();
			const code = await harness.approve(attempt.authorizeUrl);
			const authorization = await attempt.complete(code);
			expect(authorization.accountId).toBe(harness.accountId);
			expect(authorization.secret).not.toBe("");
		});

		it("reports another account's own id, showing only that account's folders", async () => {
			const harness = await createHarness();
			await harness.addFolder("Work");
			const attempt = await harness.connectStep.startAuthorization();
			const other = await attempt.complete(await harness.approveAsOther(attempt.authorizeUrl));
			expect(other.accountId).toBe(harness.otherAccountId);
			expect(other.accountId).not.toBe(harness.accountId);
			expect(await harness.connectStep.access(other.secret).listRoots(".marker")).toEqual([]);
		});

		it("refuses a code used a second time with auth", async () => {
			const harness = await createHarness();
			const attempt = await harness.connectStep.startAuthorization();
			const code = await harness.approve(attempt.authorizeUrl);
			await attempt.complete(code);
			await expectFailure(attempt.complete(code), "auth");
		});

		it("refuses a code the service never issued with auth", async () => {
			const harness = await createHarness();
			const attempt = await harness.connectStep.startAuthorization();
			await expectFailure(attempt.complete("not-a-code"), "auth");
		});

		it("lists the folders that can be a root, marking those that hold the marker", async () => {
			const harness = await createHarness();
			await harness.addFolder("Work", [".marker"]);
			await harness.addFolder("Notes", ["Daily"]);
			const access = harness.connectStep.access(await logIn(harness));
			const roots = await access.listRoots(".marker");
			expect(roots.map(({ name, holdsMarker }) => ({ name, holdsMarker }))).toEqual(
				expect.arrayContaining([
					{ name: "Work", holdsMarker: true },
					{ name: "Notes", holdsMarker: false },
				]),
			);
			expect(roots).toHaveLength(2);
		});

		it("creates a root folder, listed unmarked under the name given", async () => {
			const harness = await createHarness();
			const access = harness.connectStep.access(await logIn(harness));
			const created = await access.createRoot("My vault");
			expect(created).toMatchObject({ name: "My vault", holdsMarker: false });
			expect(await access.listRoots(".marker")).toEqual([created]);
		});

		it("keeps a root name with non-ASCII characters exactly", async () => {
			const harness = await createHarness();
			const access = harness.connectStep.access(await logIn(harness));
			await access.createRoot("Заметки café 日本");
			const [root] = await access.listRoots(".marker");
			expect(root?.name).toBe("Заметки café 日本");
		});

		it("refuses to create a root under a taken name with preconditionFailed", async () => {
			const harness = await createHarness();
			await harness.addFolder("My vault");
			const access = harness.connectStep.access(await logIn(harness));
			await expectFailure(access.createRoot("My vault"), "preconditionFailed");
		});

		it("marks a root once the marker folder is created inside it", async () => {
			const harness = await createHarness();
			const access = harness.connectStep.access(await logIn(harness));
			const { root } = await access.createRoot("My vault");
			await access.openRoot(root).createFolder(".marker");
			expect(await access.listRoots(".marker")).toEqual([
				expect.objectContaining({ root, name: "My vault", holdsMarker: true }),
			]);
		});

		it("writes a file inside a root only while it is absent, when asked to", async () => {
			const harness = await createHarness();
			const access = harness.connectStep.access(await logIn(harness));
			const setup = access.openRoot((await access.createRoot("My vault")).root);
			await setup.createFolder(".marker");
			const written = await setup.write(".marker/settings.json", bytes("{}"), { kind: "absent" });
			expect(written).toMatchObject({ kind: "file", path: ".marker/settings.json", size: 2 });
			await expectFailure(
				setup.write(".marker/settings.json", bytes("{ }"), { kind: "absent" }),
				"preconditionFailed",
			);
		});

		it("keeps working after the access token expires", async () => {
			const harness = await createHarness();
			const access = harness.connectStep.access(await logIn(harness));
			await access.createRoot("Before");
			harness.expireAccessTokens();
			await access.createRoot("After");
			expect(await access.listRoots(".marker")).toHaveLength(2);
		});

		it("opens the account again from the stored secret alone", async () => {
			const harness = await createHarness();
			const secret = await logIn(harness);
			await harness.connectStep.access(secret).createRoot("My vault");
			const later = harness.connectStep.access(secret);
			expect(await later.listRoots(".marker")).toEqual([expect.objectContaining({ name: "My vault" })]);
		});

		it("refuses a revoked secret with auth, while another login keeps working", async () => {
			const harness = await createHarness();
			const laptop = await logIn(harness);
			const phone = await logIn(harness);
			await harness.connectStep.access(laptop).revoke();
			await expectFailure(harness.connectStep.access(laptop).listRoots(".marker"), "auth");
			expect(await harness.connectStep.access(phone).listRoots(".marker")).toEqual([]);
		});
	});
}
