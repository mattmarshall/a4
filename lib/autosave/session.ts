/**
 * PageSession: keeps one open page saved without losing work.
 *
 * - `update(text)` journals the edit synchronously, then schedules a save
 *   600 ms after the last edit and at most 4 s after the first unsaved edit.
 * - `flush()` saves now (tab hidden, page switch, Ctrl/Cmd+S).
 * - Saves pass the expected revision. On conflict the local text is saved as a
 *   "(conflict …)" copy and the session follows the copy; if the page was
 *   deleted it is recreated; other failures retry with backoff (1 s → 30 s).
 */

import { availableName, stamp } from "../store/names.ts";
import {
  isStoreError,
  type Page,
  type PageName,
  type PageStore,
  type Revision,
  type WriteResult,
} from "../store/types.ts";
import type { Journal } from "./journal.ts";

export type SaveStatus = "saved" | "unsaved" | "saving" | "error";

export type SessionEvent =
  | { type: "status"; status: SaveStatus }
  | { type: "saved"; result: WriteResult }
  | { type: "conflict"; original: PageName; copy: PageName }
  | { type: "recreated"; original: PageName; name: PageName }
  | { type: "error"; error: unknown; retryInMs: number };

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

export interface PageSessionOptions {
  store: PageStore;
  journal: Journal;
  page: Page;
  scheduler?: Scheduler;
  debounceMs?: number;
  maxWaitMs?: number;
  onEvent?: (event: SessionEvent) => void;
}

export class PageSession {
  readonly #store: PageStore;
  readonly #journal: Journal;
  readonly #scheduler: Scheduler;
  readonly #debounceMs: number;
  readonly #maxWaitMs: number;
  readonly #onEvent: (event: SessionEvent) => void;

  #name: PageName;
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

  constructor(options: PageSessionOptions) {
    this.#store = options.store;
    this.#journal = options.journal;
    this.#scheduler = options.scheduler ?? realScheduler;
    this.#debounceMs = options.debounceMs ?? DEBOUNCE_MS;
    this.#maxWaitMs = options.maxWaitMs ?? MAX_WAIT_MS;
    this.#onEvent = options.onEvent ?? (() => {});
    this.#name = options.page.name;
    this.#text = options.page.text;
    this.#savedText = options.page.text;
    this.#revision = options.page.revision;
  }

  get name(): PageName {
    return this.#name;
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
      const result = await this.#store.write(name, text, this.#revision);
      this.#accept(result, text);
      this.#onEvent({ type: "saved", result });
    } catch (error) {
      if (isStoreError(error, "conflict")) {
        await this.#relocate(`${name} (conflict ${stamp()})`, (copy) => ({ type: "conflict", original: name, copy }));
      } else if (isStoreError(error, "not-found")) {
        await this.#relocate(name, (created) => ({ type: "recreated", original: name, name: created }));
      } else {
        this.#fail(error);
      }
    }
  }

  /** Save the current text as a new page and make the session follow it. */
  async #relocate(desired: string, event: (name: PageName) => SessionEvent): Promise<void> {
    const previous = this.#name;
    const text = this.#text;
    try {
      const target = await availableName(this.#store, desired);
      const result = await this.#store.create(target, text);
      this.#journal.clear(previous);
      this.#name = result.name;
      this.#accept(result, text);
      this.#onEvent(event(result.name));
    } catch (error) {
      this.#fail(error);
    }
  }

  #accept(result: WriteResult, savedText: string) {
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
  adoptRemote(page: Page): boolean {
    if (this.dirty || this.#saving || page.name !== this.#name) return false;
    this.#text = page.text;
    this.#savedText = page.text;
    this.#revision = page.revision;
    return true;
  }

  /** Rename the page (after saving pending edits). */
  async rename(to: PageName): Promise<WriteResult> {
    await this.flush();
    const from = this.#name;
    const result = await this.#store.rename(from, to);
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
