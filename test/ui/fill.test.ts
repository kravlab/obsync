import { describe, expect, it } from "vitest";
import { fill } from "../../src/ui/i18n/fill";

describe("fill", () => {
	it("replaces each placeholder with its value", () => {
		expect(fill("Connected as {device}.", { device: "Laptop" })).toBe("Connected as Laptop.");
	});

	it("inserts values literally, even ones that look like placeholders or replacement patterns", () => {
		expect(fill("{a} and {b}", { a: "{b}", b: "$&" })).toBe("{b} and $&");
	});

	it("leaves a placeholder without a value as it is", () => {
		expect(fill("Hello {name}", {})).toBe("Hello {name}");
	});

	it("does not take a value from the object prototype", () => {
		expect(fill("{constructor}", {})).toBe("{constructor}");
	});
});
