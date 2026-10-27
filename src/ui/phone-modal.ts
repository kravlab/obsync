import { Platform, type Modal } from "obsidian";

/**
 * Marks `modal` on a phone so the stylesheet makes its buttons at least
 * 44 px tall, big enough to tap (spec, "Status, notices, guidance"). Every
 * modal of the plugin calls it when it is built; one without buttons, such
 * as the restore list, only carries the class.
 */
export function fitForPhone(modal: Modal): void {
	if (Platform.isPhone) modal.modalEl.addClass("obsync-phone");
}
