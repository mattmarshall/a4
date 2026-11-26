/**
 * The English for workspace notices: a sentence and a toast tone for each.
 * The same sentences A4 showed before notices became data.
 *
 * Relative imports, so Node's test runner can load this file.
 */

import { assertNever } from "../../lib/page/index.ts";
import type { Recovery } from "../../lib/persist/index.ts";
import { describeError, type WorkspaceNotice } from "../../lib/workspace/index.ts";

type Tone = "info" | "warn";

export interface NoticeCopy {
  readonly message: string;
  readonly tone: Tone;
}

function recovery(r: Recovery<string>, where: string): string {
  return r.kind === "copied" || r.kind === "recreated" ? `“${r.page}” (saved ${where}“${r.savedAs}”)` : `“${r.page}”`;
}

function failure(notice: Extract<WorkspaceNotice, { kind: "failed" }>): string {
  const reason = describeError(notice.error);
  switch (notice.action) {
    case "list-folder":
      return `Couldn’t list the folder: ${reason}`;
    case "recover-folder":
      return `Couldn’t recover drafts for “${notice.subject ?? "the folder"}”: ${reason}`;
    case "reopen-file":
      return reason;
    case "open-folder":
      return `Couldn’t open that folder: ${reason}`;
    case "reconnect-folder":
      return `Couldn’t reconnect: ${reason}`;
    case "start":
      return `Couldn’t open page storage: ${reason}`;
    default:
      return assertNever(notice.action);
  }
}

export function describeNotice(notice: WorkspaceNotice): NoticeCopy {
  switch (notice.kind) {
    case "recovered-library":
      return {
        message: `Recovered unsaved edits from a closed tab: ${notice.recoveries.map((r) => recovery(r, "as ")).join(", ")}.`,
        tone: "warn",
      };
    case "recovered-folder":
      return {
        message: `Recovered unsaved edits to ${notice.recoveries.map((r) => recovery(r, "in the library as ")).join(", ")}.`,
        tone: "warn",
      };
    case "migrated":
      return { message: `Imported ${notice.count} page(s) from the previous version.`, tone: "info" };
    case "moved-from-fallback":
      return { message: `Moved ${notice.count} page(s) into the file system store.`, tone: "info" };
    case "not-durable":
      return { message: "This browser can’t store pages. Work will be lost on reload.", tone: "warn" };
    case "conflict":
      return {
        message: notice.moved
          ? `“${notice.original}” changed on disk, so your version was saved in the library as “${notice.copy}”. The file was not changed.`
          : `“${notice.original}” was changed in another tab. Your version was saved as “${notice.copy}”.`,
        tone: "warn",
      };
    case "recreated":
      return {
        message: notice.moved
          ? `“${notice.original}” was deleted on disk, so your edits were saved in the library as “${notice.name}”.`
          : `“${notice.original}” was deleted elsewhere, so your edits were saved as “${notice.name}”.`,
        tone: "warn",
      };
    case "trashed":
      return { message: `Moved “${notice.name}” to the trash.`, tone: "info" };
    case "restored":
      return { message: `Restored “${notice.name}”.`, tone: "info" };
    case "reloaded":
      return { message: `“${notice.path}” changed on disk and was reloaded.`, tone: "info" };
    case "folder-copies":
      return {
        message: `Saved leftover edits in the library: ${notice.copies.map((c) => `“${c}”`).join(", ")}.`,
        tone: "warn",
      };
    case "saved-to-folder":
      return { message: `Saved “${notice.name}” to the folder as “${notice.path}”.`, tone: "info" };
    case "still-no-access":
      return { message: `A4 still doesn’t have access to “${notice.folder}”.`, tone: "warn" };
    case "served-unreachable":
      return {
        message: `${describeError(notice.error)} Showing this browser’s library. Run “a4 serve <folder>”, then switch in the Pages panel (or open the link it prints).`,
        tone: "warn",
      };
    case "failed":
      return { message: failure(notice), tone: "warn" };
    default:
      return assertNever(notice);
  }
}
