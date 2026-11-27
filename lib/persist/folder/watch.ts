/**
 * Notice changes made outside A4 to the open folder files.
 *
 * While the tab is visible, each watched file is polled every second
 * (`FolderFs.stat`: modification time and size). When either changes, the file
 * is read and its revision compared with the session's. A session with no
 * unsaved edits adopts the new text; one with unsaved edits is left alone,
 * and its next save meets a revision conflict, which saves A4's text as a
 * library copy instead of overwriting the file.
 */

import { PollLoop } from "../autosave/poll.ts";
import type { PageSession, Scheduler } from "../autosave/session.ts";
import type { FilePath } from "../store/refs.ts";
import type { Page } from "../store/types.ts";
import type { ConnectedFolder } from "./access.ts";
import type { FileStat } from "./fs.ts";

const POLL_MS = 1000;

interface Watched {
  path: FilePath;
  session: PageSession<FilePath>;
  last: FileStat | null;
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
  readonly #onReloaded: (key: string, page: Page<FilePath>) => void;
  readonly #watched = new Map<string, Watched>();
  readonly #loop: PollLoop;

  constructor(options: FileWatcherOptions) {
    this.#folder = options.folder;
    this.#onReloaded = options.onReloaded;
    this.#loop = new PollLoop({
      scheduler: options.scheduler,
      intervalMs: options.intervalMs ?? POLL_MS,
      isVisible: options.isVisible,
      poll: () => this.#poll(),
      active: () => this.#watched.size > 0,
    });
  }

  /**
   * Watch `path` for `key` (a slot), replacing what that key watched. The same
   * file and session keep the last stat seen. Anything else starts with none,
   * so the first poll reads the file and compares its revision with the
   * session's: a change made just before (during a swap or a library switch)
   * is adopted, not taken as the starting point.
   */
  watch(key: string, path: FilePath, session: PageSession<FilePath>): void {
    const prior = this.#watched.get(key);
    const last = prior && prior.path === path && prior.session === session ? prior.last : null;
    this.#watched.set(key, { path, session, last });
    this.#loop.start();
  }

  unwatch(key: string): void {
    this.#watched.delete(key);
  }

  stop(): void {
    this.#loop.stop();
    this.#watched.clear();
  }

  async #stat(path: FilePath): Promise<FileStat | null> {
    try {
      return await this.#folder.fs.stat(path);
    } catch {
      return null;
    }
  }

  /** One poll of every watched file. Exposed for tests. */
  tick(): Promise<void> {
    return this.#loop.tick();
  }

  async #poll(): Promise<void> {
    for (const [key, entry] of [...this.#watched]) {
      if (entry.session.stopped) {
        this.#watched.delete(key);
        continue;
      }
      const stat = await this.#stat(entry.path);
      const same = stat && entry.last && stat.modifiedAt === entry.last.modifiedAt && stat.size === entry.last.size;
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
  }
}
