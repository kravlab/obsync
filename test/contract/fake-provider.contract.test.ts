import { FakeRemote } from "../fakes/fake-remote";
import { describeProviderContract } from "./provider-contract";

describeProviderContract("FakeProvider", () =>
	Promise.resolve(new FakeRemote({ changeFeed: true, stableIds: true, fileMove: true, folderMove: true, serverHashes: true }).openProvider()),
);
