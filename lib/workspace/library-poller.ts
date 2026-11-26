/**
 * Notices changes made to the served library outside A4, such as an agent
 * writing `<folder>/pages/Brief.md`. Every 2 seconds while the tab is visible,
 * it lists the pages and compares each one's size and modification time with
 * the last listing. Pages added, removed, or changed are reported, and the
 * workspace handles them as it does another tab's saves.
 *
 * A listing that fails (the server stopped) is skipped; the next one compares
 * against the last that succeeded.
 */

import type { Scheduler } from "../persist/autosave/session.ts";
import type { PageName, PageStore, PageSummary } from "../persist/store/types.ts";

const SERVED_POLL_MS = 2000;

export interface PollerChange {
  /** Pages new or changed since the last listing. */
  readonly changed: readonly PageName[];
  /** Whether pages were added or removed. */
  readonly listChanged: boolean;
}

export class LibraryPoller {
  readonly #store: PageStore;
  readonly #scheduler: Scheduler;
  readonly #isVisible: () => boolean;
  readonly #onChange: (change: PollerChange) => Promise<void>;
  #last: ReadonlyMap<PageName, PageSummary> | null = null;
  #timer: unknown = null;
  #ticking = false;
  #stopped = false;

  constructor(options: {
    store: PageStore;
    scheduler: Scheduler;
    isVisible: () => boolean;
    /** The listing the workspace starts from, so only later changes are reported. */
    initial: readonly PageSummary[];
    onChange: (change: PollerChange) => Promise<void>;
  }) {
    this.#store = options.store;
    this.#scheduler = options.scheduler;
    this.#isVisible = options.isVisible;
    this.#onChange = options.onChange;
    this.#last = new Map(options.initial.map((p) => [p.name, p]));
    this.#schedule();
  }

  stop(): void {
    this.#stopped = true;
    if (this.#timer !== null) this.#scheduler.clearTimeout(this.#timer);
    this.#timer = null;
  }

  #schedule(): void {
    if (this.#stopped) return;
    this.#timer = this.#scheduler.setTimeout(() => {
      this.#timer = null;
      void this.tick().finally(() => this.#schedule());
    }, SERVED_POLL_MS);
  }

  /** List the pages once and report what changed (skipped while hidden, stopped, or already listing). */
  async tick(): Promise<void> {
    if (this.#ticking || this.#stopped || !this.#isVisible()) return;
    this.#ticking = true;
    try {
      let list: PageSummary[];
      try {
        list = await this.#store.list();
      } catch {
        return;
      }
      if (this.#stopped) return;
      const last = this.#last ?? new Map<PageName, PageSummary>();
      const next = new Map(list.map((p) => [p.name, p]));
      const changed = list
        .filter((p) => {
          const before = last.get(p.name);
          return !before || before.size !== p.size || before.modifiedAt !== p.modifiedAt;
        })
        .map((p) => p.name);
      const listChanged = next.size !== last.size || [...last.keys()].some((name) => !next.has(name));
      this.#last = next;
      if (changed.length > 0 || listChanged) await this.#onChange({ changed, listChanged });
    } finally {
      this.#ticking = false;
    }
  }
}
