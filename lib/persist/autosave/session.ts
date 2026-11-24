/**
 * PageSession: keeps one open page saved without losing work.
 *
 * - `update(text)` journals the edit synchronously, then schedules a save
 *   600 ms after the last edit and at most 4 s after the first unsaved edit.
 * - `flush()` saves now (tab hidden, page switch, Ctrl/Cmd+S).
 * - Saves pass the expected revision. On conflict the local text is saved as a
 *   "(conflict …)" copy and the session follows the copy; if the page was
 *   deleted it is recreated; other failures retry with backoff (1 s → 30 s).
 * - Where that text goes depends on the session's `RelocationPolicy`. A
 *   library session (`same-store`) saves the copy in its own store and
 *   follows it. A folder file's session (`copy-out`) saves the copy in the
 *   library, stops, and reports it with `moved: true`, so the workbench can
 *   open the copy; a folder file is never recreated. Edits typed while the
 *   copy was being saved are journaled under the copy (in the library
 *   journal) and reported as `pendingText`.
 * - A session opened on a page with a draft from this tab (a save that
 *   failed before the page was closed) starts from the draft and saves it,
 *   expecting the draft's base revision, so a page changed since becomes a
 *   conflict copy rather than being overwritten.
 */

import { stamp } from "../store/names.ts";
import type { FilePath } from "../store/refs.ts";
import {
  isStoreError,
  type Page,
  type PageFiles,
  type PageName,
  type PageStore,
  type Revision,
  type WriteResult,
} from "../store/types.ts";
import type { Journal } from "./journal.ts";

/**
 * A store a session can relocate into while keeping its own identifiers:
 * new pages are created by page name and come back as `Id`. A `PageStore`
 * is one for `Id = PageName`; folder files are not, so a file session can't
 * follow a copy in its own store.
 */
export type SameStorePages<Id extends string> = PageFiles<Id> & {
  /** Create a page under a free variant of `desired`, claimed under its lock (`PageStore.createUnique`). */
  createUnique(desired: string, text: string): Promise<WriteResult<Id & PageName>>;
};

/** Text that can't be saved over its page follows a copy in the same store. */
export interface SameStorePolicy<Id extends string> {
  readonly kind: "same-store";
  readonly store: SameStorePages<Id>;
}

/** Text that can't be saved over its page goes to a copy in the library, and the session stops. */
export interface CopyOutPolicy<Id extends string> {
  readonly kind: "copy-out";
  readonly library: PageStore;
  /** This tab's library journal, for edits typed while a copy is saved. */
  readonly libraryJournal: Journal<PageName>;
  /** The desired name of a copy: the page's identifier plus `suffix`. */
  readonly copyName: (id: Id, suffix: string) => string;
}

/** Where a session or a recovery puts text it can't save over its page. */
export type RelocationPolicy<Id extends string> = SameStorePolicy<Id> | CopyOutPolicy<Id>;

export type SaveStatus = "saved" | "unsaved" | "saving" | "error";

export type SessionEvent<Id extends string = PageName> =
  | { type: "status"; status: SaveStatus }
  | { type: "saved"; result: WriteResult<Id> }
  /**
   * `moved`: the copy is in the `copies` store and this session has stopped.
   * `pendingText`: edits typed while the copy was saved, not in the copy yet.
   */
  | { type: "conflict"; original: Id; copy: PageName; moved: boolean; pendingText?: string }
  | { type: "recreated"; original: Id; name: PageName; moved: boolean; pendingText?: string }
  /** `retryInMs` is null when retrying can't help (the store refused the text). */
  | { type: "error"; error: unknown; retryInMs: number | null };

export interface Scheduler {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const realScheduler: Scheduler = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export const DEBOUNCE_MS = 600;
export const MAX_WAIT_MS = 4000;
export const RETRY_BASE_MS = 1000;
export const RETRY_MAX_MS = 30000;

/** Timing and events, shared by every kind of session. */
export interface PageSessionOptions<Id extends string = PageName> {
  scheduler?: Scheduler;
  debounceMs?: number;
  maxWaitMs?: number;
  onEvent?: (event: SessionEvent<Id>) => void;
}

/** Open a library page: conflict copies stay in the library, and the page can be renamed. */
export function createLibrarySession(
  store: PageStore,
  journal: Journal<PageName>,
  page: Page,
  options: PageSessionOptions = {},
): LibrarySession {
  return new LibrarySession(store, journal, page, options);
}

/** Open a folder file: conflict copies and orphaned text go to the library. */
export function createFileSession(
  files: PageFiles<FilePath>,
  journal: Journal<FilePath>,
  page: Page<FilePath>,
  copyOut: Omit<CopyOutPolicy<FilePath>, "kind">,
  options: PageSessionOptions<FilePath> = {},
): PageSession<FilePath> {
  return new PageSession(files, journal, page, { kind: "copy-out", ...copyOut }, options);
}

export class PageSession<Id extends string = PageName> {
  readonly #files: PageFiles<Id>;
  readonly #journal: Journal<Id>;
  readonly #policy: RelocationPolicy<Id>;
  readonly #scheduler: Scheduler;
  readonly #debounceMs: number;
  readonly #maxWaitMs: number;
  readonly #onEvent: (event: SessionEvent<Id>) => void;

  #name: Id;
  #text: string;
  #savedText: string;
  #revision: Revision;
  #status: SaveStatus = "saved";
  #debounce: unknown = null;
  #maxWait: unknown = null;
  #retry: unknown = null;
  #attempt = 0;
  #saving: Promise<void> | null = null;
  #disposed = false;

  constructor(
    files: PageFiles<Id>,
    journal: Journal<Id>,
    page: Page<Id>,
    policy: RelocationPolicy<Id>,
    options: PageSessionOptions<Id> = {},
  ) {
    this.#files = files;
    this.#journal = journal;
    this.#policy = policy;
    this.#scheduler = options.scheduler ?? realScheduler;
    this.#debounceMs = options.debounceMs ?? DEBOUNCE_MS;
    this.#maxWaitMs = options.maxWaitMs ?? MAX_WAIT_MS;
    this.#onEvent = options.onEvent ?? (() => {});
    this.#name = page.name;
    this.#text = page.text;
    this.#savedText = page.text;
    this.#revision = page.revision;
    // A draft this tab left for this page (its last save failed) wins over the
    // stored text. Saving expects the draft's base, so a page changed since
    // becomes a conflict copy instead of being overwritten.
    const draft = this.#journal.get(this.#name);
    if (draft && draft.text !== page.text) {
      this.#text = draft.text;
      if (draft.base != null) this.#revision = draft.base;
      this.#status = "unsaved";
      this.#schedule(0);
    }
  }

  get name(): Id {
    return this.#name;
  }
  /** True once the session has stopped, after `dispose` or a move to the library. */
  get stopped(): boolean {
    return this.#disposed;
  }
  get text(): string {
    return this.#text;
  }
  get revision(): Revision {
    return this.#revision;
  }
  get status(): SaveStatus {
    return this.#status;
  }
  get dirty(): boolean {
    return this.#text !== this.#savedText;
  }

  #setStatus(status: SaveStatus) {
    if (this.#status === status) return;
    this.#status = status;
    this.#onEvent({ type: "status", status });
  }

  #clearTimers() {
    for (const t of [this.#debounce, this.#maxWait, this.#retry]) if (t !== null) this.#scheduler.clearTimeout(t);
    this.#debounce = this.#maxWait = this.#retry = null;
  }

  #schedule(ms: number) {
    if (this.#debounce !== null) this.#scheduler.clearTimeout(this.#debounce);
    this.#debounce = this.#scheduler.setTimeout(() => void this.flush(), ms);
    if (this.#maxWait === null) {
      this.#maxWait = this.#scheduler.setTimeout(() => void this.flush(), this.#maxWaitMs);
    }
  }

  /** Record an edit. Journals it synchronously and schedules a save. */
  update(text: string): void {
    if (this.#disposed || text === this.#text) return;
    this.#text = text;
    if (!this.dirty) {
      this.#journal.clear(this.#name);
      if (!this.#saving) {
        this.#clearTimers();
        this.#setStatus("saved");
      }
      return;
    }
    const journaled = this.#journal.set(this.#name, text, this.#revision);
    if (this.#status !== "error") this.#setStatus("unsaved");
    // If the journal refused the draft, don't wait: the store is the only copy.
    this.#schedule(journaled ? this.#debounceMs : 0);
  }

  /**
   * Save now. Waits for any in-flight save, then saves until the latest text
   * is stored. Resolves early (status "error") when a retry has been scheduled.
   */
  async flush(): Promise<void> {
    for (;;) {
      if (this.#saving) {
        await this.#saving;
        continue;
      }
      if (this.#disposed) return;
      this.#clearTimers();
      if (!this.dirty) {
        this.#setStatus("saved");
        return;
      }
      this.#saving = this.#save().finally(() => {
        this.#saving = null;
      });
      await this.#saving;
      if (this.#status === "error" || !this.dirty) return;
    }
  }

  async #save(): Promise<void> {
    const text = this.#text;
    const name = this.#name;
    this.#setStatus("saving");
    try {
      const result = await this.#files.write(name, text, this.#revision);
      this.#accept(result, text);
      this.#onEvent({ type: "saved", result });
    } catch (error) {
      if (isStoreError(error, "conflict")) {
        await this.#relocate(this.#copyName(name, ` (conflict ${stamp()})`), (copy, moved) => ({
          type: "conflict",
          original: name,
          copy,
          moved,
        }));
      } else if (isStoreError(error, "not-found")) {
        // A page missing from its own store is recreated under its name; a
        // folder file is never recreated: its text goes to the library.
        const desired =
          this.#policy.kind === "copy-out" ? this.#copyName(name, ` (recovered ${stamp()})`) : this.#copyName(name, "");
        await this.#relocate(desired, (created, moved) => ({
          type: "recreated",
          original: name,
          name: created,
          moved,
        }));
      } else {
        this.#fail(error);
      }
    }
  }

  #copyName(id: Id, suffix: string): string {
    return this.#policy.kind === "copy-out" ? this.#policy.copyName(id, suffix) : `${id}${suffix}`;
  }

  /**
   * Save the current text as a new page. In the same store, the session
   * follows it; in the library (`copy-out`), the session stops.
   */
  async #relocate(desired: string, event: (name: PageName, moved: boolean) => SessionEvent<Id>): Promise<void> {
    const previous = this.#name;
    const text = this.#text;
    const policy = this.#policy;
    try {
      if (policy.kind === "copy-out") {
        const result = await policy.library.createUnique(desired, text);
        // Keys typed while the copy was saved belong to the copy now: journal
        // them under it before dropping the old draft, so a crash keeps them.
        const pending = this.#text !== text ? this.#text : undefined;
        if (pending !== undefined) policy.libraryJournal.set(result.name, pending, result.revision);
        this.#journal.clear(previous);
        this.#savedText = this.#text;
        this.#attempt = 0;
        this.#disposed = true;
        this.#clearTimers();
        this.#setStatus("saved");
        const moved = event(result.name, true);
        this.#onEvent(pending === undefined ? moved : withPendingText(moved, pending));
        return;
      }
      const result = await policy.store.createUnique(desired, text);
      this.#journal.clear(previous);
      this.#name = result.name;
      this.#accept(result, text);
      this.#onEvent(event(result.name, false));
    } catch (error) {
      this.#fail(error);
    }
  }

  #accept(result: WriteResult<Id>, savedText: string) {
    this.#revision = result.revision;
    this.#savedText = savedText;
    this.#attempt = 0;
    if (this.#text === savedText) {
      this.#journal.clear(this.#name);
      this.#setStatus("saved");
    } else {
      // Edits arrived while saving; keep the journal current and save again.
      this.#journal.set(this.#name, this.#text, this.#revision);
      this.#setStatus("unsaved");
      this.#schedule(this.#debounceMs);
    }
  }

  #fail(error: unknown) {
    if (isStoreError(error, "invalid-text")) {
      // The same text will be refused again: report it and wait for an edit.
      this.#setStatus("error");
      this.#onEvent({ type: "error", error, retryInMs: null });
      return;
    }
    const retryInMs = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** this.#attempt);
    this.#attempt++;
    this.#setStatus("error");
    this.#onEvent({ type: "error", error, retryInMs });
    if (!this.#disposed) {
      this.#retry = this.#scheduler.setTimeout(() => {
        this.#retry = null;
        void this.flush();
      }, retryInMs);
    }
  }

  /**
   * Another tab saved this page. Adopt its text when this tab has no unsaved
   * edits; otherwise keep ours (the next save will detect the conflict).
   */
  adoptRemote(page: Page<Id>): boolean {
    if (this.#disposed || this.dirty || this.#saving || page.name !== this.#name) return false;
    this.#text = page.text;
    this.#savedText = page.text;
    this.#revision = page.revision;
    return true;
  }

  /**
   * Save pending edits, then move the page with `move` (a rename) and follow
   * it. For subclasses whose store can rename.
   */
  protected async follow(move: (from: Id) => Promise<WriteResult<Id>>): Promise<WriteResult<Id>> {
    await this.flush();
    const from = this.#name;
    const result = await move(from);
    this.#journal.clear(from);
    this.#name = result.name;
    if (this.dirty) this.#journal.set(this.#name, this.#text, this.#revision);
    return result;
  }

  /** Save pending edits and stop. */
  async dispose(): Promise<void> {
    await this.flush();
    this.#disposed = true;
    this.#clearTimers();
  }
}

/** A library page's session: it can also rename the page. */
export class LibrarySession extends PageSession<PageName> {
  readonly #store: PageStore;

  constructor(store: PageStore, journal: Journal<PageName>, page: Page, options: PageSessionOptions = {}) {
    super(store, journal, page, { kind: "same-store", store }, options);
    this.#store = store;
  }

  /** Rename the page, after saving pending edits. */
  rename(to: PageName): Promise<WriteResult> {
    return this.follow((from) => this.#store.rename(from, to));
  }
}

function withPendingText<Id extends string>(event: SessionEvent<Id>, pendingText: string): SessionEvent<Id> {
  return event.type === "conflict" || event.type === "recreated" ? { ...event, pendingText } : event;
}
