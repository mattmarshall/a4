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

import { PollLoop } from "../persist/autosave/poll.ts";
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
  readonly #onChange: (change: PollerChange) => Promise<void>;
  readonly #loop: PollLoop;
  #last: ReadonlyMap<PageName, PageSummary> | null = null;

  constructor(options: {
    store: PageStore;
    scheduler: Scheduler;
    isVisible: () => boolean;
    /** The listing the workspace starts from, so only later changes are reported. */
    initial: readonly PageSummary[];
    onChange: (change: PollerChange) => Promise<void>;
  }) {
    this.#store = options.store;
    this.#onChange = options.onChange;
    this.#last = new Map(options.initial.map((p) => [p.name, p]));
    this.#loop = new PollLoop({
      scheduler: options.scheduler,
      intervalMs: SERVED_POLL_MS,
      isVisible: options.isVisible,
      poll: () => this.#poll(),
    });
    this.#loop.start();
  }

  stop(): void {
    this.#loop.stop();
  }

  /** List the pages once and report what changed (skipped while hidden, stopped, or already listing). */
  tick(): Promise<void> {
    return this.#loop.tick();
  }

  async #poll(): Promise<void> {
    let list: PageSummary[];
    try {
      list = await this.#store.list();
    } catch {
      return;
    }
    if (this.#loop.stopped) return;
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
  }
}
