import { describe, expect, it } from "vitest";
import { withVaultWrites } from "../../src/engine/local-vault";
import { FakeVault } from "../fakes/fake-vault";
import { ManualClock } from "../fakes/manual-clock";
import { bytes, text } from "../support/bytes";

/** A vault keeping state in a private field, which only the vault itself, not a proxy of it, can reach. */
class CountingVault extends FakeVault {
	#reads = 0;

	/** How many times `read` ran. */
	get reads(): number {
		return this.#reads;
	}

	override read(path: string): Promise<ArrayBuffer> {
		this.#reads += 1;
		return super.read(path);
	}
}

describe("withVaultWrites", () => {
	it("calls the given writing methods in place of the vault's own", async () => {
		const vault = new FakeVault({ clock: new ManualClock() });
		const written: string[] = [];
		const wrapped = withVaultWrites(vault, {
			write: async (path, data) => {
				written.push(path);
				await vault.write(path, data);
			},
		});

		await wrapped.write("note.md", bytes("hello"));

		expect(written).toEqual(["note.md"]);
		expect(text(await vault.read("note.md"))).toBe("hello");
	});

	it("leaves every other member as the vault's, its methods running on the vault itself", async () => {
		const vault = new CountingVault({ clock: new ManualClock(), configDir: ".vault-config" });
		const wrapped = withVaultWrites(vault, {});

		await wrapped.createFolder("notes");
		await vault.write("notes/a.md", bytes("a"));

		expect(wrapped.configDir).toBe(".vault-config");
		expect(text(await wrapped.read("notes/a.md"))).toBe("a");
		expect(vault.reads).toBe(1);
		expect((await vault.stat("notes"))?.kind).toBe("folder");
	});
});
