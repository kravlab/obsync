import type {
	AccountAccess,
	Authorization,
	ConnectStep,
	AuthorizationAttempt,
	RootCandidate,
} from "../../src/engine/connect-step";
import { ProviderError, type Provider, type ProviderFailure } from "../../src/engine/provider";
import type { FakeProvider } from "./fake-provider";
import { FakeRemote, type FakeServiceOptions } from "./fake-remote";

/** The connect-step operations a FakeConnectStep can inject faults into. */
export type FakeConnectOperation =
	| "startAuthorization"
	| "complete"
	| "listRoots"
	| "createRoot"
	| "revoke"
	| "createFolder"
	| "write";

/**
 * An in-memory cloud service with accounts, for the connect step. Each
 * account holds folders where Remote roots live, each folder a FakeRemote
 * named by its folder name, which is also its root.
 *
 * A login follows the paste-the-code flow: `startAuthorization` gives an authorize
 * page, `FakeAccount.approve` plays the user approving it and returns the
 * code shown, and the code is single-use. Every completed login issues its
 * own secret, so revoking one device's secret leaves the others working.
 */
export class FakeService {
	private readonly accounts = new Map<string, FakeAccount>();
	/** Secrets issued and not revoked, with the account each opens. */
	private readonly secrets = new Map<string, FakeAccount>();
	/** Codes approved and not used yet: the login attempt and the account. */
	private readonly codes = new Map<string, { readonly attempt: number; readonly account: FakeAccount }>();
	private lastAttempt = 0;
	private lastIssued = 0;

	/**
	 * Creates an account with no folders; every folder made in it supports
	 * what `folderService` says (conditional writes and nothing more by default).
	 */
	addAccount(accountId: string, folderService: FakeServiceOptions = {}): FakeAccount {
		const account = new FakeAccount(this, accountId, folderService);
		this.accounts.set(accountId, account);
		return account;
	}

	/** Opens the connect step, as one device would. */
	connectStep(): FakeConnectStep {
		return new FakeConnectStep(this);
	}

	/** The authorize page of a new login attempt. */
	newAuthorizeUrl(): string {
		this.lastAttempt += 1;
		return `https://fake-service.test/authorize?attempt=${this.lastAttempt}`;
	}

	/** Issues the code `account` approved the attempt at `authorizeUrl` with. */
	issueCode(authorizeUrl: string, account: FakeAccount): string {
		const attempt = attemptOf(authorizeUrl);
		if (attempt === undefined) throw new Error(`not an authorize page: ${authorizeUrl}`);
		const code = `code-${this.next()}`;
		this.codes.set(code, { attempt, account });
		return code;
	}

	/** Exchanges a code issued for `authorizeUrl` for an Authorization, once. */
	redeem(authorizeUrl: string, code: string): Authorization {
		const issued = this.codes.get(code);
		if (!issued || issued.attempt !== attemptOf(authorizeUrl)) {
			throw new ProviderError({ category: "auth" }, `code refused: ${code}`);
		}
		this.codes.delete(code);
		const secret = `secret-${this.next()}`;
		this.secrets.set(secret, issued.account);
		return { secret, accountId: issued.account.accountId };
	}

	/** The account a secret opens; fails with `auth` for a revoked or unknown one. */
	accountOf(secret: string): FakeAccount {
		const account = this.secrets.get(secret);
		if (!account) throw new ProviderError({ category: "auth" }, "secret refused");
		return account;
	}

	/** Makes `secret` stop working. */
	revoke(secret: string): void {
		this.accountOf(secret);
		this.secrets.delete(secret);
	}

	/** A number never handed out before, for codes and secrets. */
	private next(): number {
		this.lastIssued += 1;
		return this.lastIssued;
	}
}

/** One account at a FakeService. */
export class FakeAccount {
	/** Folders where Remote roots live, by name. */
	readonly folders = new Map<string, FakeRemote>();

	/**
	 * @param service the service holding the account
	 * @param accountId the id a login to this account reports
	 * @param folderService what every folder of the account supports
	 */
	constructor(
		private readonly service: FakeService,
		readonly accountId: string,
		private readonly folderService: FakeServiceOptions,
	) {}

	/** Plays the user approving the login at `authorizeUrl`; returns the code. */
	approve(authorizeUrl: string): string {
		return this.service.issueCode(authorizeUrl, this);
	}

	/** Creates an empty folder named `name` and returns its Remote. */
	addFolder(name: string): FakeRemote {
		const remote = new FakeRemote(this.folderService);
		this.folders.set(name, remote);
		return remote;
	}
}

/**
 * One device's connect step on a FakeService. Tests make its next calls fail
 * through `failNext`, e.g. a revoke while offline.
 */
export class FakeConnectStep implements ConnectStep {
	readonly providerId = "fake-service";
	private readonly failures = new Map<FakeConnectOperation, ProviderFailure[]>();

	/** @param service the service this device logs in to */
	constructor(private readonly service: FakeService) {}

	/** Makes the next call of `operation` fail with `failure`, doing nothing. */
	failNext(operation: FakeConnectOperation, failure: ProviderFailure): void {
		const queue = this.failures.get(operation) ?? [];
		queue.push(failure);
		this.failures.set(operation, queue);
	}

	startAuthorization(): Promise<AuthorizationAttempt> {
		return this.run("startAuthorization", () => {
			const authorizeUrl = this.service.newAuthorizeUrl();
			return {
				authorizeUrl,
				complete: (code) => this.run("complete", () => this.service.redeem(authorizeUrl, code)),
			};
		});
	}

	access(secret: string): AccountAccess {
		const account = (): FakeAccount => this.service.accountOf(secret);
		return {
			listRoots: (marker) =>
				this.run("listRoots", () =>
					[...account().folders].map(([name, remote]) => candidate(name, remote, marker)),
				),
			createRoot: (name) =>
				this.run("createRoot", () => {
					const { folders } = account();
					if (folders.has(name)) {
						throw new ProviderError({ category: "preconditionFailed" }, `root taken: ${name}`);
					}
					account().addFolder(name);
					return { root: name, name, holdsMarker: false };
				}),
			openRoot: (root) => this.openRoot(account, root),
			revoke: () => this.run("revoke", () => this.service.revoke(secret)),
		};
	}

	/**
	 * The Provider on `root`, checking the secret and the root again on
	 * every call like a real service does. Its Capabilities and name rules
	 * are the root's own.
	 */
	private openRoot(account: () => FakeAccount, root: string): Provider {
		const provider = (): FakeProvider => {
			const found = account().folders.get(root);
			if (!found) throw new ProviderError({ category: "notFound" }, `no root: ${root}`);
			return found.openProvider();
		};
		const { capabilities, nameRules, maxFileSize } = provider();
		return {
			capabilities,
			nameRules,
			maxFileSize,
			list: () => Promise.resolve().then(() => provider().list()),
			read: (path) => Promise.resolve().then(() => provider().read(path)),
			delete: (path, precondition) => Promise.resolve().then(() => provider().delete(path, precondition)),
			createFolder: (path) => this.run("createFolder", () => provider().createFolder(path)),
			write: (path, data, precondition) => this.run("write", () => provider().write(path, data, precondition)),
		};
	}

	/** Runs one operation, failing first with a queued failure if any. */
	private run<T>(operation: FakeConnectOperation, effect: () => T | PromiseLike<T>): Promise<T> {
		return Promise.resolve().then(() => {
			const failure = this.failures.get(operation)?.shift();
			if (failure) throw new ProviderError(failure, `injected ${failure.category} on ${operation}`);
			return effect();
		});
	}
}

/** The candidate for the folder `name`, marked if it holds `marker`. */
function candidate(name: string, remote: FakeRemote, marker: string): RootCandidate {
	return { root: name, name, holdsMarker: remote.get(marker) !== undefined };
}

/** The login attempt number in a fake authorize page address. */
function attemptOf(authorizeUrl: string): number | undefined {
	const attempt = new URL(authorizeUrl).searchParams.get("attempt");
	return attempt === null ? undefined : Number(attempt);
}
