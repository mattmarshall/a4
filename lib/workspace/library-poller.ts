/**
 * Watches the served library while it's shown. Every 2 seconds while the tab
 * is visible, it first asks `a4 serve` which library it serves (`GetLibrary`):
 *
 * - **Another library** (a different folder, served at the same address with
 *   the same token): reported as `replaced`, for the workspace to show it.
 * - **Refused** (a new token, or another protocol version): reported as
 *   `refused`, for the workspace to show this browser's library.
 * - **Not reached, or an answer A4 can't read:** the pass is skipped, since
 *   the server may be restarting. The next pass asks again.
 *
 * Either report stops the poller: it watched a library that's no longer
 * there. Otherwise it lists the pages and compares each one's size and
 * modification time with the last listing. Pages added, removed, or changed
 * (an agent writing `<folder>/pages/Brief.md`, say) are reported, and the
 * workspace handles them as it does another tab's saves. A listing that
 * fails is skipped; the next one compares against the last that succeeded.
 */

import { PollLoop } from "../persist/autosave/poll.ts";
import type { Scheduler } from "../persist/autosave/session.ts";
import type { ServedStore } from "../persist/store/remote.ts";
import {
  isStoreError,
  type PageName,
  type PageSummary,
  type StoreUnavailableError,
  type UnavailableReason,
} from "../persist/store/types.ts";
import type { LibraryId } from "../persist/store/wire.ts";

const SERVED_POLL_MS = 2000;

/** The reasons A4 can no longer use the server, as a switch to it would be refused. */
const REFUSED: ReadonlySet<UnavailableReason> = new Set(["refused", "older-server", "newer-server"]);

/** What one pass found. */
export type PollerReport =
  | {
      readonly kind: "changed";
      /** Pages new or changed since the last listing. */
      readonly changed: readonly PageName[];
      /** Whether pages were added or removed. */
      readonly listChanged: boolean;
    }
  /** Another library is served behind the same connection. */
  | { readonly kind: "replaced" }
  /** The server refuses this browser now, for its token or its version. */
  | { readonly kind: "refused"; readonly error: StoreUnavailableError };

export class LibraryPoller {
  readonly #store: ServedStore;
  readonly #library: LibraryId;
  readonly #onReport: (report: PollerReport) => Promise<void>;
  readonly #loop: PollLoop;
  #last: ReadonlyMap<PageName, PageSummary>;

  constructor(options: {
    store: ServedStore;
    /** The id of the library shown, as the server named it when it was reached. */
    library: LibraryId;
    scheduler: Scheduler;
    isVisible: () => boolean;
    /** The listing the workspace starts from, so only later changes are reported. */
    initial: readonly PageSummary[];
    onReport: (report: PollerReport) => Promise<void>;
  }) {
    this.#store = options.store;
    this.#library = options.library;
    this.#onReport = options.onReport;
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

  /** Check the library once and report what changed (skipped while hidden, stopped, or already checking). */
  tick(): Promise<void> {
    return this.#loop.tick();
  }

  async #poll(): Promise<void> {
    let library: LibraryId;
    try {
      library = await this.#store.library();
    } catch (error) {
      if (this.#loop.stopped || !isStoreError(error, "unavailable")) return;
      if (error.reason && REFUSED.has(error.reason)) await this.#end({ kind: "refused", error });
      return;
    }
    if (this.#loop.stopped) return;
    if (library !== this.#library) {
      await this.#end({ kind: "replaced" });
      return;
    }

    let list: PageSummary[];
    try {
      list = await this.#store.list();
    } catch {
      return;
    }
    if (this.#loop.stopped) return;
    const last = this.#last;
    const next = new Map(list.map((p) => [p.name, p]));
    const changed = list
      .filter((p) => {
        const before = last.get(p.name);
        return !before || before.size !== p.size || before.modifiedAt !== p.modifiedAt;
      })
      .map((p) => p.name);
    const listChanged = next.size !== last.size || [...last.keys()].some((name) => !next.has(name));
    this.#last = next;
    if (changed.length > 0 || listChanged) await this.#onReport({ kind: "changed", changed, listChanged });
  }

  /** Stop, then report why: the library watched is no longer the one served. */
  async #end(report: PollerReport): Promise<void> {
    this.#loop.stop();
    await this.#onReport(report);
  }
}
