import type { Provider } from "../../src/engine/provider";
import { createDropboxConnector } from "../../src/providers/dropbox/provider";
import { FakeDropbox, type FakeDropboxAccount } from "../fakes/fake-dropbox";
import { ManualClock } from "../fakes/manual-clock";

/** A fake Dropbox with one account, its Remote "/My vault", and the Provider opened on it. */
export interface DropboxRemote {
	readonly dropbox: FakeDropbox;
	readonly account: FakeDropboxAccount;
	readonly provider: Provider;
}

/** Opens the Dropbox Provider on the Remote "/My vault" of a new fake account, as a connected device would. */
export async function openDropboxRemote(): Promise<DropboxRemote> {
	const clock = new ManualClock();
	const dropbox = new FakeDropbox("test-app-key", clock);
	const account = dropbox.addAccount("dbid:account-1");
	account.putFolder("/My vault");
	const connector = createDropboxConnector({ appKey: "test-app-key", http: dropbox.requestUrl, clock });
	const provider = await connector.open(
		{ accountId: account.accountId, remoteRoot: "/My vault", device: { id: "laptop-id", name: "Laptop" } },
		dropbox.issueRefreshToken(account),
	);
	return { dropbox, account, provider };
}
