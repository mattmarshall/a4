/**
 * The workspace's public shapes: its snapshot, the notices it emits, and the
 * results its commands return. Notices and errors are data; the UI writes
 * the English (components/workspace/notices.ts).
 */

import type { Recovery } from "../persist/autosave/bootstrap.ts";
import type { SaveStatus } from "../persist/autosave/session.ts";
import type { FolderState } from "../persist/folder/access.ts";
import type { FolderFile } from "../persist/folder/scan.ts";
import type { Letter, StackReport } from "../desk/index.ts";
import type { FilePath, FileRef, LibraryRef } from "../persist/store/refs.ts";
import type { PageName, PageSummary, StoreKind, TrashEntry, UnavailableReason } from "../persist/store/types.ts";
import type { Slot } from "./pending.ts";

export type { Slot } from "./pending.ts";

export const SLOTS: readonly Slot[] = ["a", "b"];

export type { FileRef, LibraryRef } from "../persist/store/refs.ts";

export interface StorageInfo {
  readonly kind: StoreKind;
  readonly durable: boolean;
  /** Whether the browser keeps storage under pressure; null when it can't say. */
  readonly persistent: boolean | null;
}

interface SlotBase {
  /** The page name or the file path, for display; null when empty. */
  readonly label: string | null;
  readonly text: string;
  readonly status: SaveStatus;
  /** A sealed letter: shown read-only, and edits are dropped. */
  readonly readOnly: boolean;
}

/** What a slot shows: nothing, a library page, or a folder file. */
export type SlotSnapshot =
  | (SlotBase & { readonly ref: null; readonly name: null })
  | (SlotBase & { readonly ref: LibraryRef; readonly name: PageName })
  | (SlotBase & { readonly ref: FileRef; readonly name: null });

export interface FolderSnapshot {
  readonly state: FolderState;
  readonly files: readonly FolderFile[];
  /** Each letter's state and postmark, oldest first (paths match `files`). */
  readonly letters: readonly Letter[];
  /** Each stack in `.agents/stacks/`, judged as a whole, in name order (page paths match `files`). */
  readonly stacks: readonly StackReport[];
  /** True when the scan stopped at the entry limit. */
  readonly partial: boolean;
  readonly scanning: boolean;
}

export type WorkspaceStatus =
  | { readonly kind: "starting" }
  | { readonly kind: "ready" }
  | { readonly kind: "failed"; readonly error: unknown };

export interface WorkspaceSnapshot {
  readonly status: WorkspaceStatus;
  readonly storage: StorageInfo | null;
  readonly library: { readonly pages: readonly PageSummary[]; readonly trash: readonly TrashEntry[] };
  readonly slots: Readonly<Record<Slot, SlotSnapshot>>;
  readonly folder: FolderSnapshot;
  /** The served library this browser connects to, and whether its pages are the ones shown; null when none. */
  readonly served: { readonly address: string; readonly shown: boolean } | null;
}

/** What failed, for a `failed` notice. */
type WorkspaceAction = "list-folder" | "recover-folder" | "reopen-file" | "open-folder" | "reconnect-folder" | "start";

/** Something the author should hear about. The UI turns each into a sentence and a tone. */
export type WorkspaceNotice =
  /** Drafts left by tabs that closed, recovered at startup. */
  | { readonly kind: "recovered-library"; readonly recoveries: readonly Recovery[] }
  /** Drafts of the folder's files, recovered when it connected. */
  | { readonly kind: "recovered-folder"; readonly recoveries: readonly Recovery<FilePath>[] }
  | { readonly kind: "migrated"; readonly count: number }
  | { readonly kind: "moved-from-fallback"; readonly count: number }
  | { readonly kind: "not-durable" }
  /** A save met a newer version; `moved`: a file's text went to the library. */
  | { readonly kind: "conflict"; readonly original: string; readonly copy: PageName; readonly moved: boolean }
  /** A save found its page or file gone; `moved`: a file's text went to the library. */
  | { readonly kind: "recreated"; readonly original: string; readonly name: PageName; readonly moved: boolean }
  | { readonly kind: "trashed"; readonly name: PageName }
  | { readonly kind: "restored"; readonly name: PageName }
  /** An open file changed on disk and was reloaded. */
  | { readonly kind: "reloaded"; readonly path: FilePath }
  /** Leftover edits saved in the library when the folder was closed. */
  | { readonly kind: "folder-copies"; readonly copies: readonly PageName[] }
  | { readonly kind: "saved-to-folder"; readonly name: PageName; readonly path: string }
  | { readonly kind: "still-no-access"; readonly folder: string }
  /**
   * The served library can't be used, so this browser's library is shown:
   * why (not running, the token refused, another protocol version, an answer
   * A4 can't read), and the error.
   */
  | {
      readonly kind: "served-unreachable";
      readonly address: string;
      readonly reason: UnavailableReason | null;
      readonly error: unknown;
    }
  | {
      readonly kind: "failed";
      readonly action: WorkspaceAction;
      /** The folder or file it was about, when there is one. */
      readonly subject: string | null;
      readonly error: unknown;
    };

/** A command's outcome. Commands never throw to the UI. */
export type Result<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: unknown };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

/** Run `fn`, turning a throw into a failed result. */
export async function attempt<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return ok(await fn());
  } catch (error) {
    return { ok: false, error };
  }
}
