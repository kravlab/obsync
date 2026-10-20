/**
 * Conflict blocks in reading view (spec, "Architecture and modules"): each
 * block shows as an "Unresolved conflict" panel with both sides rendered
 * as Markdown and no buttons; resolving happens in editing view. The
 * markers never reach Obsidian's Markdown rendering, where a `=======`
 * line could turn the line above it into a heading.
 *
 * Reading view renders a note in sections. A section a block touches is
 * rebuilt from `sectionPieces`: its plain text rendered as before, the
 * panel where the block starts, nothing for a block's later lines. A
 * section is left as Obsidian rendered it when its section information is
 * missing, or does not hold the note up to the section's last line.
 */
import { MarkdownRenderChild, MarkdownRenderer, type App, type MarkdownPostProcessor } from "obsidian";
import { sectionPieces, type ConflictBlock } from "../engine/conflict-blocks";
import { shownSides } from "./conflict-sides";
import type { Strings } from "./i18n/strings";

/** The post-processor showing Conflict blocks as panels. */
export function conflictReadingView(app: App, strings: Strings): MarkdownPostProcessor {
	return async (el, ctx) => {
		const info = ctx.getSectionInfo(el);
		// The documentation does not promise the whole note here: without it, nothing is changed.
		if (info === null || info.text.split("\n").length <= info.lineEnd) return;
		const pieces = sectionPieces(info.text, info.lineStart, info.lineEnd);
		if (pieces === null) return;
		const child = new MarkdownRenderChild(el);
		ctx.addChild(child);
		el.empty();
		for (const piece of pieces) {
			if (piece.kind === "text") {
				await MarkdownRenderer.render(app, piece.text, el.createDiv(), ctx.sourcePath, child);
			} else {
				await renderPanel(app, strings, piece.block, el.createDiv({ cls: "obsync-conflict-panel" }), ctx.sourcePath, child);
			}
		}
	};
}

/** Renders `block` into `panel`: the heading, a hint, and each side under its label. */
async function renderPanel(
	app: App,
	strings: Strings,
	block: ConflictBlock,
	panel: HTMLElement,
	sourcePath: string,
	component: MarkdownRenderChild,
): Promise<void> {
	panel.createDiv({ cls: "obsync-conflict-panel-title", text: strings.conflictUnresolved });
	panel.createDiv({ cls: "obsync-conflict-panel-hint", text: strings.conflictUnresolvedHint });
	for (const { label, text, cls } of shownSides(block, strings)) {
		const side = panel.createDiv({ cls: `obsync-conflict-panel-side ${cls}` });
		side.createDiv({ cls: "obsync-conflict-panel-label", text: label });
		await MarkdownRenderer.render(app, text, side.createDiv(), sourcePath, component);
	}
}
