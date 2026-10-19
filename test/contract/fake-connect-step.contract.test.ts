import { FakeService } from "../fakes/fake-service";
import { describeConnectStepContract } from "./connect-step-contract";

describeConnectStepContract("FakeService", () => {
	const service = new FakeService();
	const account = service.addAccount("account-1");
	const other = service.addAccount("account-2");
	return Promise.resolve({
		connectStep: service.connectStep(),
		accountId: account.accountId,
		approve: (authorizeUrl) => Promise.resolve(account.approve(authorizeUrl)),
		otherAccountId: other.accountId,
		approveAsOther: (authorizeUrl) => Promise.resolve(other.approve(authorizeUrl)),
		addFolder: (name, children = []) => {
			const remote = account.addFolder(name);
			for (const child of children) remote.put(child, { kind: "folder" });
			return Promise.resolve();
		},
		// The fake has no access tokens to expire.
		expireAccessTokens: () => undefined,
	});
});
