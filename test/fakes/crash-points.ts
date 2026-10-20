/**
 * Thrown in place of a result when a test makes the device "crash": the
 * app was killed between two steps. It is not a ProviderError, so no
 * engine code may treat it as a provider failure; the test drops the
 * engine and starts a new one over the same stores.
 */
export class SimulatedCrash extends Error {
	override readonly name = "SimulatedCrash";
}

/**
 * The steps of one device at which a test can make it crash: its
 * provider's operations, and the engine's vault writes and Device store
 * saves. They count together, so "the `n`th step" crosses all three.
 */
export class CrashPoints {
	/** Steps taken so far. */
	private count = 0;
	private crash: { readonly at: number; readonly when: "before" | "after" } | undefined;

	/** Makes the `n`th step from now throw SimulatedCrash without taking effect. */
	crashBefore(n: number): void {
		this.crash = { at: this.count + n, when: "before" };
	}

	/** Makes the `n`th step from now take effect, then throw SimulatedCrash. */
	crashAfter(n: number): void {
		this.crash = { at: this.count + n, when: "after" };
	}

	/** Takes one step named `name`, running `effect` unless the device crashes before it. */
	async step<T>(name: string, effect: () => Promise<T>): Promise<T> {
		this.count += 1;
		const crashesHere = this.crash?.at === this.count ? this.crash.when : undefined;
		if (crashesHere === "before") throw new SimulatedCrash(`crash before ${name}`);
		const result = await effect();
		if (crashesHere === "after") throw new SimulatedCrash(`crash after ${name}`);
		return result;
	}
}
