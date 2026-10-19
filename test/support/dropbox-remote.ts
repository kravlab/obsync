import type { Provider } from "../../src/engine/provider";
import type { DropboxTransfers } from "../../src/providers/dropbox/options";
import { createDropboxConnector } from "../../src/providers/dropbox/provider";
import { DEFAULT_REQUEST_LIMIT, type RequestLimit } from "../../src/engine/request-limit";
import { FakeDropbox, type FakeDropboxAccount } from "../fakes/fake-dropbox";
import { ManualClock } from "../fakes/manual-clock";

/** A fake Dropbox with one account, its Remote "/My vault", and the Provider opened on it. */
export interface DropboxRemote {
	readonly dropbox: FakeDropbox;
	readonly account: FakeDropboxAccount;
	readonly provider: Provider;
	/** Every pause the Provider asked for, in ms, oldest first; none is really waited. */
	readonly waits: readonly number[];
}

/** How to open the Provider; anything left out is as a new device has it. */
export interface DropboxRemoteOptions {
	/** The per-request limit in bytes; the setting's default if left out. */
	readonly requestLimitBytes?: number;
}

/**
 * A Per-request limit of `bytes`, which the setting itself would not take
 * unless a whole number of MiB: tests keep their files small.
 */
export function testRequestLimit(bytes: number): RequestLimit {
	return { mebibytes: bytes / (1024 * 1024), bytes };
}

/**
 * Transfer options for tests: the Per-request limit in bytes (the
 * setting's default if left out), and pauses recorded in `waits` instead
 * of waited.
 */
export function testTransfers(requestLimitBytes?: number, waits: number[] = []): DropboxTransfers {
	const limit = requestLimitBytes === undefined ? DEFAULT_REQUEST_LIMIT : testRequestLimit(requestLimitBytes);
	return {
		requestLimit: () => limit,
		wait: (ms) => {
			waits.push(ms);
			return Promise.resolve();
		},
	};
}

/** Opens the Dropbox Provider on the Remote "/My vault" of a new fake account, as a connected device would. */
export async function openDropboxRemote(options: DropboxRemoteOptions = {}): Promise<DropboxRemote> {
	const clock = new ManualClock();
	const dropbox = new FakeDropbox("test-app-key", clock);
	const account = dropbox.addAccount("dbid:account-1");
	account.putFolder("/My vault");
	const waits: number[] = [];
	const transfers = testTransfers(options.requestLimitBytes, waits);
	const connector = createDropboxConnector({ appKey: "test-app-key", http: dropbox.requestUrl, clock, transfers });
	const provider = await connector.open(
		{ accountId: account.accountId, remoteRoot: "/My vault", device: { id: "laptop-id", name: "Laptop" } },
		dropbox.issueRefreshToken(account),
	);
	return { dropbox, account, provider, waits };
}
