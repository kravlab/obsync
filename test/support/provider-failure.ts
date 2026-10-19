import { expect } from "vitest";
import { ProviderError, type ProviderErrorCategory } from "../../src/engine/provider";
import { rejection } from "./assertions";

/** Asserts that `operation` rejects with a ProviderError of `category`. */
export async function expectFailure(operation: Promise<unknown>, category: ProviderErrorCategory): Promise<void> {
	const error = await rejection(operation);
	expect(error).toBeInstanceOf(ProviderError);
	expect((error as ProviderError).failure.category).toBe(category);
}
