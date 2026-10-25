/**
 * Vitest setup for every test file: the fake `obsidian` module's shared
 * state (notices shown, platform flags, language, the `requestUrl`
 * handler) starts afresh in each test.
 */
import { beforeEach } from "vitest";
import { resetObsidianFake } from "../fakes/obsidian";

beforeEach(() => {
	resetObsidianFake();
});
