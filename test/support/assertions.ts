import { expect } from "vitest";

/**
 * Waits for `operation` and returns why it rejected, failing the test if it
 * fulfils instead.
 */
export async function rejection(operation: Promise<unknown>): Promise<unknown> {
	let fulfilled = false;
	const reason = await operation.then(
		() => {
			fulfilled = true;
		},
		(reason: unknown) => reason,
	);
	expect(fulfilled, "expected the operation to reject").toBe(false);
	return reason;
}

/** Returns a Capability the test expects to be reported, failing otherwise. */
export function reported<T>(capability: T | undefined): T {
	expect(capability).toBeDefined();
	return capability as T;
}
