/**
 * One slot (A or B): the only owner of what the slot shows, its latest text,
 * its save status, and its session. Typed by ref kind: a library page has a
 * LibrarySession (which can rename), a folder file a PageSession over the
 * folder (which copies out to the library).
 */

import type { Journal } from "../autosave/journal.ts";
import {
  createFileSession,
  createLibrarySession,
  type LibrarySession,
  type PageSession,
  type PageSessionOptions,
  type SaveStatus,
} from "../autosave/session.ts";
import type { ConnectedFolder } from "../folder/access.ts";
import { fileCopyName, fileRef, libraryRef, refLabel, type FilePath } from "../store/refs.ts";
import type { Page, PageName, PageStore } from "../store/types.ts";
import type { FileRef, LibraryRef, Slot, SlotSnapshot } from "./types.ts";

/** What a slot holds: a library page's session, or a folder file's. */
export type OpenPage =
  | { readonly kind: "library"; ref: LibraryRef; readonly session: LibrarySession }
  | { readonly kind: "file"; readonly ref: FileRef; readonly session: PageSession<FilePath> };

/** The library a slot's sessions save into. */
export interface SlotLibrary {
  readonly store: PageStore;
  readonly journal: Journal<PageName>;
}

export const EMPTY_SLOT: SlotSnapshot = { ref: null, name: null, label: null, text: "", status: "saved" };

export class SlotController {
  readonly slot: Slot;
  readonly #onChange: () => void;
  #open: OpenPage | null = null;
  #text = "";
  #status: SaveStatus = "saved";
  #snapshot: SlotSnapshot = EMPTY_SLOT;

  constructor(slot: Slot, onChange: () => void) {
    this.slot = slot;
    this.#onChange = onChange;
  }

  get open(): OpenPage | null {
    return this.#open;
  }

  /** The latest text: what the author typed, even before the session saves it. */
  get text(): string {
    return this.#text;
  }

  get snapshot(): SlotSnapshot {
    return this.#snapshot;
  }

  #publish(): void {
    const open = this.#open;
    const base = { text: this.#text, status: this.#status };
    if (!open) this.#snapshot = { ...EMPTY_SLOT, ...base };
    else if (open.kind === "library") {
      this.#snapshot = { ref: open.ref, name: open.ref.name, label: refLabel(open.ref), ...base };
    } else this.#snapshot = { ref: open.ref, name: null, label: refLabel(open.ref), ...base };
    this.#onChange();
  }

  /** Show `open` (or nothing). The caller has disposed whatever was shown. */
  show(open: OpenPage | null): void {
    this.#open = open;
    // The session may have resumed a draft this tab left (its last save failed).
    this.#text = open?.session.text ?? "";
    this.#status = open?.session.status ?? "saved";
    this.#publish();
  }

  /** Take what the slot shows without disposing it (to move it to the other slot). */
  take(): OpenPage | null {
    const open = this.#open;
    this.#open = null;
    return open;
  }

  /** The session's save status changed. */
  status(status: SaveStatus): void {
    if (this.#status === status) return;
    this.#status = status;
    this.#publish();
  }

  /** Record an edit: journaled and scheduled by the session, shown at once. */
  edit(text: string): void {
    const open = this.#open;
    if (!open) return;
    this.#text = text;
    open.session.update(text);
    this.#status = open.session.status;
    this.#publish();
  }

  /** Another tab saved this library page: adopt it when there are no unsaved edits. */
  adoptLibraryPage(page: Page): boolean {
    const open = this.#open;
    return open?.kind === "library" && this.#adopted(open.session.adoptRemote(page), page.text);
  }

  /** The open file changed on disk and its session adopted it (the watcher did). */
  adoptedFile(text: string): void {
    this.#adopted(true, text);
  }

  #adopted(adopted: boolean, text: string): boolean {
    if (adopted) {
      this.#text = text;
      this.#publish();
    }
    return adopted;
  }

  /** A library session followed a copy or a rename: show its new name. */
  follow(name: PageName): void {
    const open = this.#open;
    if (open?.kind !== "library") return;
    open.ref = libraryRef(name);
    this.#publish();
  }

  async flush(): Promise<void> {
    await this.#open?.session.flush();
  }

  /** True when nothing is open, the session stopped, or everything is saved. */
  get saved(): boolean {
    const open = this.#open;
    return !open || open.session.stopped || open.session.status === "saved";
  }

  /** Save and close what the slot shows, and show nothing. */
  async close(): Promise<void> {
    const open = this.#open;
    if (!open) return;
    await open.session.dispose();
    if (this.#open === open) this.show(null);
  }
}

/** Build a session for a library page, routing its events through `onEvent`. */
export function openLibraryPage(library: SlotLibrary, page: Page, options: PageSessionOptions): OpenPage {
  return {
    kind: "library",
    ref: libraryRef(page.name),
    session: createLibrarySession(library.store, library.journal, page, options),
  };
}

/** Build a session for a folder file, routing its events through `onEvent`. */
export function openFolderFile(
  library: SlotLibrary,
  folder: ConnectedFolder,
  page: Page<FilePath>,
  options: PageSessionOptions<FilePath>,
): OpenPage {
  const session = createFileSession(
    folder.sheet,
    folder.journal,
    page,
    { library: library.store, libraryJournal: library.journal, copyName: fileCopyName },
    options,
  );
  return { kind: "file", ref: fileRef(page.name), session };
}
