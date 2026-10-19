import { createDropboxConnectStep } from "../../src/providers/dropbox/connect-step";
import { FakeDropbox } from "../fakes/fake-dropbox";
import { ManualClock } from "../fakes/manual-clock";
import { testTransfers } from "../support/dropbox-remote";
import { describeConnectStepContract } from "./connect-step-contract";

describeConnectStepContract("Dropbox", () => {
	const clock = new ManualClock();
	const dropbox = new FakeDropbox("test-app-key", clock);
	const account = dropbox.addAccount("dbid:account-1");
	const other = dropbox.addAccount("dbid:account-2");
	return Promise.resolve({
		connectStep: createDropboxConnectStep({
			appKey: "test-app-key",
			http: dropbox.requestUrl,
			clock,
			transfers: testTransfers(),
		}),
		accountId: account.accountId,
		approve: (authorizeUrl) => Promise.resolve(dropbox.approve(authorizeUrl, account)),
		otherAccountId: other.accountId,
		approveAsOther: (authorizeUrl) => Promise.resolve(dropbox.approve(authorizeUrl, other)),
		addFolder: (name, children = []) => {
			account.putFolder(`/${name}`);
			for (const child of children) account.putFolder(`/${name}/${child}`);
			return Promise.resolve();
		},
		expireAccessTokens: () => dropbox.expireAccessTokens(),
	});
});
