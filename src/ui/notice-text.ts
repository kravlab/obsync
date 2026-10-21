import type { SyncNotice } from "../engine/notices";
import { fill } from "./i18n/fill";
import type { Strings } from "./i18n/strings";

/** The text that tells the user a sync notice, in their language. */
export function noticeText(notice: SyncNotice, strings: Strings): string {
	switch (notice.kind) {
		case "conflictCopyCreated":
			return fill(strings.noticeConflictCopyCreated, { file: notice.path, copy: notice.copyPath });
		case "restoredAfterDelete":
			return fill(
				notice.deletedOn === "thisDevice" ? strings.noticeRestoredDeletedHere : strings.noticeRestoredDeletedThere,
				{ file: notice.path },
			);
		case "renamedOnBoth":
			return fill(strings.noticeRenamedOnBoth, { file: notice.path, local: notice.localPath });
		case "renameBeatsDelete":
			return fill(
				notice.deletedOn === "thisDevice" ? strings.noticeRenamedDeletedHere : strings.noticeRenamedDeletedThere,
				{ file: notice.path },
			);
	}
}
