/**
 * Notice changes made outside A4 to the open folder files.
 *
 * While the tab is visible, each watched file is polled every second
 * (`getFile()`: modification time and size). When either changes, the file
 * is read and its revision compared with the session's. A session with no
 * unsaved edits adopts the new text; one with unsaved edits is left alone,
 * and its next save meets a revision conflict, which saves A4's text as a
 * library copy instead of overwriting the file.
 */

import type { PageSession, Scheduler } from "../autosave/session.ts";
import type { FilePath } from "../store/refs.ts";
import type { Page } from "../store/types.ts";
import type { ConnectedFolder } from "./connection.ts";

export const POLL_MS = 1000;

interface Stat {
  lastModified: number;
  size: number;
}

interface Watched {
  path: FilePath;
  session: PageSession<FilePath>;
  last: Stat | null;
}

export interface FileWatcherOptions {
  folder: ConnectedFolder;
  scheduler: Scheduler;
  isVisible: () => boolean;
  /** A watched session adopted text changed on disk. */
  onReloaded: (key: string, page: Page<FilePath>) => void;
  intervalMs?: number;
}

export class FileWatcher {
  readonly #folder: ConnectedFolder;
  readonly #scheduler: Scheduler;
  readonly #isVisible: () => boolean;
  readonly #onReloaded: (key: string, page: Page<FilePath>) => void;
  readonly #intervalMs: number;
  readonly #watched = new Map<string, Watched>();
  #timer: unknown = null;
  #ticking = false;
  #stopped = false;

  constructor(options: FileWatcherOptions) {
    this.#folder = options.folder;
    this.#scheduler = options.scheduler;
    this.#isVisible = options.isVisible;
    this.#onReloaded = options.onReloaded;
    this.#intervalMs = options.intervalMs ?? POLL_MS;
  }

  /** Watch `path` for `key` (a slot), replacing what that key watched. */
  watch(key: string, path: FilePath, session: PageSession<FilePath>): void {
    this.#watched.set(key, { path, session, last: null });
    void this.#stat(path).then((stat) => {
      const entry = this.#watched.get(key);
      if (entry && entry.session === session && entry.last === null) entry.last = stat;
    });
    this.#schedule();
  }

  unwatch(key: string): void {
    this.#watched.delete(key);
  }

  stop(): void {
    this.#stopped = true;
    this.#watched.clear();
    if (this.#timer !== null) this.#scheduler.clearTimeout(this.#timer);
    this.#timer = null;
  }

  #schedule(): void {
    if (this.#stopped || this.#timer !== null || this.#watched.size === 0) return;
    this.#timer = this.#scheduler.setTimeout(() => {
      this.#timer = null;
      void this.tick().finally(() => this.#schedule());
    }, this.#intervalMs);
  }

  async #stat(path: FilePath): Promise<Stat | null> {
    try {
      const handle = await this.#folder.files.handle(path);
      if (!handle) return null;
      const file = await handle.getFile();
      return { lastModified: file.lastModified, size: file.size };
    } catch {
      return null;
    }
  }

  /** One poll of every watched file. Exposed for tests. */
  async tick(): Promise<void> {
    if (this.#ticking || this.#stopped || !this.#isVisible()) return;
    this.#ticking = true;
    try {
      for (const [key, entry] of [...this.#watched]) {
        if (entry.session.stopped) {
          this.#watched.delete(key);
          continue;
        }
        const stat = await this.#stat(entry.path);
        const same = stat && entry.last && stat.lastModified === entry.last.lastModified && stat.size === entry.last.size;
        if (same || !stat) {
          // Unchanged, or gone: a missing file is handled by the next save.
          if (!stat) entry.last = null;
          continue;
        }
        entry.last = stat;
        let page: Page<FilePath>;
        try {
          page = await this.#folder.sheet.read(entry.path);
        } catch {
          continue;
        }
        if (this.#watched.get(key) !== entry || page.revision === entry.session.revision) continue;
        if (entry.session.adoptRemote(page)) this.#onReloaded(key, page);
      }
    } finally {
      this.#ticking = false;
    }
  }
}
