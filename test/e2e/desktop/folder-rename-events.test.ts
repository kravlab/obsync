// For manual check 10, which the Vitest tests cover: the `rename` events
// Obsidian's vault gives when a folder with files inside is renamed, which
// the fake vault of those tests has to give too (test/fakes/obsidian-app.ts).
// Recorded, not judged, so it names no check in the run's summary: a change
// here means the fake and the engine's rename hints need a look.
import { describe, expect, it } from "vitest";
import { useDesktopObsidian } from "../support/desktop-obsidian";

const obsidian = useDesktopObsidian("folder-rename-events");

describe("Obsidian's events for a folder renamed with files inside", () => {
	it("gives a rename for the folder, then for each folder and file inside it in the order they were created, all before the rename resolves", async () => {
		// Created out of name order, files before folders, two levels deep, and
		// the last file in a folder made earlier, so the order of the events
		// tells creation order, name order, folders first, depth first and
		// breadth first apart. Renamed with `vault.rename`, as the plugin
		// renames (src/obsidian/local-vault.ts). The events seen by the time
		// the rename resolves are counted: the engine knows a rename as its
		// own only until then (src/engine/engine.ts, `isOwnRename`).
		const { atResolve, events } = (await obsidian().eval(`
			await app.vault.createFolder("Box");
			await app.vault.create("Box/z.md", "z");
			await app.vault.createFolder("Box/Inner");
			await app.vault.create("Box/Inner/b.md", "b");
			await app.vault.createFolder("Box/Inner/Deep");
			await app.vault.create("Box/Inner/Deep/c.md", "c");
			await app.vault.create("Box/a.md", "a");
			await app.vault.createFolder("Box/Alpha");
			await app.vault.create("Box/Inner/late.md", "late");
			const seen = [];
			const ref = app.vault.on("rename", (file, oldPath) => seen.push(oldPath + " -> " + file.path + (file.children ? " (folder)" : "")));
			try {
				await app.vault.rename(app.vault.getAbstractFileByPath("Box"), "Crate");
				const atResolve = seen.length;
				await until(() => seen.length >= 9, 5000, "nine rename events");
				// Later events, if any, arrive within this wait too.
				await wait(500);
				return { atResolve, events: seen };
			} finally {
				app.vault.offref(ref);
			}`)) as { atResolve: number; events: string[] };
		expect(atResolve).toBe(9);
		expect(events).toEqual([
			"Box -> Crate (folder)",
			"Box/z.md -> Crate/z.md",
			"Box/Inner -> Crate/Inner (folder)",
			"Box/Inner/b.md -> Crate/Inner/b.md",
			"Box/Inner/Deep -> Crate/Inner/Deep (folder)",
			"Box/Inner/Deep/c.md -> Crate/Inner/Deep/c.md",
			"Box/a.md -> Crate/a.md",
			"Box/Alpha -> Crate/Alpha (folder)",
			"Box/Inner/late.md -> Crate/Inner/late.md",
		]);
	});
});
