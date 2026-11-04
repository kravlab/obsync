// Manual check 8 on the desktop: what only Obsidian's own Markdown renders
// shows. In Live Preview a conflict block's lines look like plain text,
// every marker shown whole, though `=======` under a line makes a setext
// heading and `>>>>>>>` a quote in Markdown; in Reading view the panel
// follows the note's edits, with no stale panel and no text lost.
import { describe, expect, it } from "vitest";
import { useDesktopObsidian } from "../support/desktop-obsidian";

const obsidian = useDesktopObsidian("conflict-view");

/** A note with one block, as the sync writes it, between two plain lines. */
const NOTE = ["before", "<<<<<<< Laptop vault", "mine one", "mine two", "=======", "theirs one", ">>>>>>> Remote", "after", ""].join(
	"\n",
);

/**
 * An eval body that creates `path` holding `text` and shows it in one leaf,
 * reusing it; `show(mode)` switches that leaf to "preview" (Reading view)
 * or "source" (Live Preview) and resolves once the view shows the note.
 * `reading()` shows Reading view and reads it once Obsidian has rendered:
 * the rendering of an earlier visit stays in place until Obsidian renders
 * again, in animation frames, so it waits for frames to come and then for
 * 500 ms without a change to the rendered note.
 */
function opened(path: string, text = NOTE): string {
	return `
		const file = await app.vault.create(${JSON.stringify(path)}, ${JSON.stringify(text)});
		const leaf = app.workspace.getLeaf(true);
		const show = async (mode) => {
			await leaf.setViewState({ type: "markdown", state: { file: file.path, mode, source: false } });
			await until(() => leaf.view.getMode() === mode && leaf.view.file === file, 10000, mode + " of " + file.path);
		};
		const reading = async () => {
			await show("preview");
			const root = leaf.view.previewMode.containerEl;
			const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve(true)));
			await until(() => Promise.race([frame(), wait(1000).then(() => false)]), 10000, "an animation frame");
			let changed = Date.now();
			const observer = new MutationObserver(() => (changed = Date.now()));
			observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true });
			try {
				await until(() => Date.now() - changed >= 500 && root.textContent.includes("after"), 10000, "the rendered note to settle");
			} finally {
				observer.disconnect();
			}
			return { panels: root.querySelectorAll(".seamsync-conflict-panel").length, text: root.textContent };
		};`;
}

describe("check 8: a conflict block in the editor and in Reading view", () => {
	it("Live Preview: every line of the block, and the line after it, looks like the plain line before it, with all its text shown", async () => {
		const differing = await obsidian().eval(`
			${opened("live-preview.md")}
			await show("source");
			// The cursor on the plain line, as Obsidian shows a line's Markdown as typed only where the cursor is.
			leaf.view.editor.setCursor({ line: 0, ch: 0 });
			// A quote styled as a theme may style it, which the default theme does not.
			const quoteStyle = { "--blockquote-style": "italic", "--blockquote-color": "rgb(255, 0, 0)", "--blockquote-background-color": "rgb(0, 0, 255)" };
			for (const [name, value] of Object.entries(quoteStyle)) leaf.view.containerEl.style.setProperty(name, value);
			// The note's lines: the editor's lines and blocks the plugin shows in place of a line; the action row is none.
			const lines = await until(() => {
				const found = [...leaf.view.contentEl.querySelectorAll(".cm-content > div:not(.seamsync-conflict-actions)")];
				return found.some((line) => line.textContent === "after") ? found : null;
			}, 10000, "the editor's lines");
			const source = ${JSON.stringify(NOTE.split("\n"))};
			const from = source.findIndex((line) => line.startsWith("<<<<<<<"));
			const to = source.indexOf("after");
			if (lines.length !== source.length) throw new Error("the note's lines are not editor lines: " + lines.map((line) => line.textContent).join(" | "));
			/** The text nodes of a line a reader sees: transparent text, as Obsidian gives Markdown's quote marks, is left out. */
			const visible = (line) => {
				const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
				const nodes = [];
				for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
					const color = getComputedStyle(node.parentElement).color;
					// An alpha of 0: rgba(r, g, b, 0), or color(… / 0) and the like.
					if (color !== "transparent" && !/^rgba\\(([^,]*,){3}\\s*0\\)$|\\/\\s*0\\)$/.test(color)) nodes.push(node);
				}
				return nodes;
			};
			/** The distinct values \`read\` gives of the elements holding a line's visible text. */
			const ofText = (line, read) => [...new Set(visible(line).map((node) => read(getComputedStyle(node.parentElement))))].join(", ");
			/**
			 * How a line looks: its type, the line's and that of its text, its
			 * spacing, and whether a quote's bar is drawn before it.
			 */
			const look = (line) => {
				const style = getComputedStyle(line);
				const before = getComputedStyle(line, "::before");
				return {
					type: [style.fontSize, style.fontWeight, style.fontStyle, style.lineHeight, style.letterSpacing].join(" ") + "; text " + ofText(line, (text) => [text.fontSize, text.fontWeight, text.fontStyle].join(" ")),
					spacing: [style.paddingTop, style.paddingInlineStart, style.textIndent].join(" "),
					bar: before.display !== "none" && before.content !== "none" && before.borderInlineStartStyle !== "none",
				};
			};
			/** The text a reader sees on a line. */
			const seen = (line) => visible(line).map((node) => node.textContent).join("");
			const plain = look(lines[0]);
			const differing = [];
			for (let index = from; index <= to; index += 1) {
				const shown = look(lines[index]);
				for (const key of ["type", "spacing", "bar"]) {
					if (shown[key] !== plain[key]) differing.push(source[index] + ": " + key + " " + shown[key] + ", not " + plain[key]);
				}
				if (seen(lines[index]) !== source[index]) differing.push(source[index] + ": shows " + JSON.stringify(seen(lines[index])));
			}
			// The line after the block, neither tinted nor muted, takes the plain line's colours too.
			const ink = (line) => getComputedStyle(line).backgroundColor + "; text " + ofText(line, (text) => [text.color, text.backgroundColor].join(" "));
			if (ink(lines[to]) !== ink(lines[0])) differing.push("after: ink " + ink(lines[to]) + ", not " + ink(lines[0]));
			return { checked: to - from + 1, differing };`);
		// From <<<<<<< to the line after >>>>>>>: the block's six lines and "after".
		expect(differing).toEqual({ checked: 7, differing: [] });
	});

	it("Live Preview: a click on a marker line shows it as typed, the cursor where it was clicked; with the cursor gone it is shown plain again", async () => {
		const clicks = (await obsidian().eval(`
			${opened("click-marker.md")}
			await show("source");
			const content = leaf.view.contentEl.querySelector(".cm-content");
			/** The element showing the line ">>>>>>> Remote": the plugin's block or the editor's line. */
			const marker = () => [...content.children].find((element) => element.textContent === ">>>>>>> Remote");
			/**
			 * Clicks the marker line, shown plain, at \`where\`: "text" in the
			 * middle of its text, "beside" right of it. Answers the selection
			 * and whether the line was then shown as typed, still marked, and
			 * plain again once the cursor left.
			 */
			const click = async (where) => {
				leaf.view.editor.setCursor({ line: 0, ch: 0 });
				const plain = await until(() => (marker()?.classList.contains("cm-line") === false ? marker() : null), 10000, "the marker line shown plain");
				const text = document.createRange();
				text.selectNodeContents(plain);
				const box = text.getBoundingClientRect();
				const at = { bubbles: true, cancelable: true, button: 0, clientX: where === "text" ? box.left + box.width / 2 : box.right + 40, clientY: box.top + box.height / 2 };				plain.dispatchEvent(new MouseEvent("mousedown", at));
				plain.dispatchEvent(new MouseEvent("mouseup", at));
				const typed = await until(() => (marker()?.classList.contains("cm-line") ? marker() : null), 10000, "the marker line shown as typed");
				const selections = leaf.view.editor.listSelections();
				leaf.view.editor.setCursor({ line: 0, ch: 0 });
				const again = await until(() => (marker()?.classList.contains("cm-line") === false ? marker() : null), 10000, "the marker line shown plain again");
				return { selections, typedIsMarker: typed.classList.contains("seamsync-conflict-marker"), againIsMarker: again.classList.contains("seamsync-conflict-marker") };
			};
			return { text: await click("text"), beside: await click("beside") };`)) as Record<"text" | "beside", { selections: { anchor: { line: number; ch: number }; head: unknown }[] }>;
		const line = NOTE.split("\n").indexOf(">>>>>>> Remote");
		const length = ">>>>>>> Remote".length;
		// One cursor, no selection, on the marker line each time.
		for (const shown of Object.values(clicks)) {
			expect(shown).toMatchObject({ typedIsMarker: true, againIsMarker: true });
			expect(shown.selections).toHaveLength(1);
			expect(shown.selections[0]?.head).toEqual(shown.selections[0]?.anchor);
			expect(shown.selections[0]?.anchor.line).toBe(line);
		}
		// In the middle of the text: neither end; right of it: the end.
		expect(clicks.text.selections[0]?.anchor.ch).toBeGreaterThan(0);
		expect(clicks.text.selections[0]?.anchor.ch).toBeLessThan(length);
		expect(clicks.beside.selections[0]?.anchor.ch).toBe(length);
	});

	it("Live Preview: a quote of the note's own right after the block keeps its bar", async () => {
		const bars = (await obsidian().eval(`
			${opened("own-quote.md", NOTE.replace("after\n", "> own quote\nafter\n"))}
			await show("source");
			leaf.view.editor.setCursor({ line: 0, ch: 0 });
			const lines = await until(() => {
				const found = [...leaf.view.contentEl.querySelectorAll(".cm-content > .cm-line")].filter((line) => line.textContent.includes("own quote") || line.textContent === "after");
				return found.length === 2 ? found : null;
			}, 10000, "the quote's lines");
			return lines.map((line) => getComputedStyle(line, "::before").display !== "none");`));
		// "after" is a lazy line of the note's quote, not of the block's.
		expect(bars).toEqual([true, true]);
	});

	it("Reading view: the note as written shows one panel with both sides, and the text around it", async () => {
		const shown = (await obsidian().eval(`
			${opened("as-written.md")}
			return await reading();`)) as { panels: number; text: string };
		expect(shown.panels).toBe(1);
		for (const line of ["before", "mine one", "mine two", "theirs one", "after"]) expect(shown.text).toContain(line);
	});

	it("Reading view: after the block's lower part is edited, the panel shows the edit, with no stale panel", async () => {
		const shown = (await obsidian().eval(`
			${opened("lower-part-edited.md")}
			await reading();
			await show("source");
			const editor = leaf.view.editor;
			const at = editor.getValue().indexOf("theirs one");
			editor.replaceRange("theirs changed", editor.offsetToPos(at), editor.offsetToPos(at + "theirs one".length));
			return await reading();`)) as { panels: number; text: string };
		expect(shown.panels).toBe(1);
		expect(shown.text).toContain("theirs changed");
		expect(shown.text).not.toContain("theirs one");
		for (const line of ["before", "mine one", "mine two", "after"]) expect(shown.text).toContain(line);
	});

	it("Reading view: after only the <<<<<<< line is deleted, no panel is left and no text is lost", async () => {
		const shown = (await obsidian().eval(`
			${opened("opener-deleted.md")}
			await reading();
			await show("source");
			const editor = leaf.view.editor;
			const line = editor.getValue().split("\\n").findIndex((text) => text.startsWith("<<<<<<<"));
			editor.replaceRange("", { line, ch: 0 }, { line: line + 1, ch: 0 });
			return await reading();`)) as { panels: number; text: string };
		expect(shown.panels).toBe(0);
		for (const line of ["before", "mine one", "mine two", "theirs one", "after"]) expect(shown.text).toContain(line);
	});
});
