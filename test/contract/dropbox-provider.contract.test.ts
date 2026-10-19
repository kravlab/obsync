import { openDropboxRemote } from "../support/dropbox-remote";
import { describeProviderContract } from "./provider-contract";

describeProviderContract("Dropbox", async () => (await openDropboxRemote()).provider);
