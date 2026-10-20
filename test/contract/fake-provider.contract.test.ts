import { FakeRemote } from "../fakes/fake-remote";
import { describeProviderContract } from "./provider-contract";

describeProviderContract("FakeProvider", () => Promise.resolve(new FakeRemote({ changeFeed: true }).openProvider()));
