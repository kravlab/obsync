import { openDropboxRemote } from "../support/dropbox-remote";
import { describeProviderContract } from "./provider-contract";

describeProviderContract(
	"Dropbox",
	async () => (await openDropboxRemote()).provider,
	async (limitBytes) => {
		const { dropbox, provider } = await openDropboxRemote({ requestLimitBytes: limitBytes });
		return { provider, largestBody: () => dropbox.largestBody() };
	},
);
