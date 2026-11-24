/**
 * The open folder as the workspace sees it: access (FolderAccess), the file
 * list (scan, partial, scanning), files known to be unreadable, the watcher,
 * and recovery when it connects. When access is lost, it stops the watcher
 * and asks the workspace to close file sessions (their drafts stay in the
 * journal).
 */

import type { Journal } from "../autosave/journal.ts";
import type { PageSession, Scheduler } from "../autosave/session.ts";
import { realScheduler } from "../autosave/session.ts";
import type { ConnectedFolder, FolderAccess, FolderState } from "../folder/access.ts";
import { isFsError } from "../folder/fs.ts";
import { scanFolder, type FolderFile } from "../folder/scan.ts";
import { FileWatcher } from "../folder/watch.ts";
import { PRESETS } from "../page-spec.ts";
import { parseFilePath, type FilePath } from "../store/refs.ts";
import type { PageName, PageStore, UnreadableReason, WriteResult } from "../store/types.ts";
import { layoutRows, rowsUsed } from "../text.ts";
import type { FolderSnapshot, Slot, WorkspaceNotice } from "./types.ts";

const TERMINAL_COLS = PRESETS.terminal.cols;

/** What the folder index needs from the workspace. */
export interface FolderHost {
  readonly library: () => { store: PageStore; journal: Journal<PageName> };
  liveTabs(): Promise<ReadonlySet<string> | null>;
  notify(notice: WorkspaceNotice): void;
  changed(): void;
  /** The watcher reloaded the file shown in `slot` (its session adopted `text`). */
  reloaded(slot: Slot, path: FilePath, text: string): void;
  /** Access was lost: close the file sessions, keeping their drafts. */
  lost(): Promise<void>;
}

export class FolderIndex<H> {
  readonly access: FolderAccess<H>;
  readonly #host: FolderHost;
  readonly #scheduler: Scheduler;
  readonly #isVisible: () => boolean;
  readonly #stop: () => void;
  #files: readonly FolderFile[] = [];
  #partial = false;
  #scanning = false;
  #watcher: FileWatcher | null = null;
  /** Files that failed to open, kept across rescans until they change on disk. */
  readonly #unreadable = new Map<string, { reason: UnreadableReason; modifiedAt: number }>();
  #snapshot: FolderSnapshot;

  constructor(options: {
    access: FolderAccess<H>;
    host: FolderHost;
    scheduler?: Scheduler | undefined;
    isVisible?: (() => boolean) | undefined;
  }) {
    this.access = options.access;
    this.#host = options.host;
    this.#scheduler = options.scheduler ?? realScheduler;
    this.#isVisible = options.isVisible ?? (() => true);
    this.#snapshot = this.#build();
    let previous: FolderState = options.access.state;
    this.#stop = options.access.subscribe((state) => {
      const left = previous.status === "connected" && state.status !== "connected";
      previous = state;
      this.#publish();
      if (left) void this.#teardown();
    });
  }

  get snapshot(): FolderSnapshot {
    return this.#snapshot;
  }

  /** The connected folder, or null. */
  get folder(): ConnectedFolder | null {
    const state = this.access.state;
    return state.status === "connected" ? state.folder : null;
  }

  #build(): FolderSnapshot {
    return { state: this.access.state, files: this.#files, partial: this.#partial, scanning: this.#scanning };
  }

  #publish(): void {
    this.#snapshot = this.#build();
    this.#host.changed();
  }

  async #teardown(): Promise<void> {
    this.#watcher?.stop();
    this.#watcher = null;
    await this.#host.lost();
  }

  /** The folder connected: watch it, recover its drafts, and list it. */
  async attach(folder: ConnectedFolder): Promise<void> {
    this.#watcher?.stop();
    this.#watcher = new FileWatcher({
      folder,
      scheduler: this.#scheduler,
      isVisible: this.#isVisible,
      onReloaded: (key, page) => {
        if (key === "a" || key === "b") this.#host.reloaded(key, page.name, page.text);
      },
    });
    try {
      const { store, journal } = this.#host.library();
      const recoveries = await this.access.recover(store, journal, await this.#host.liveTabs());
      const shown = recoveries.filter((r) => r.kind !== "discarded");
      if (shown.length) this.#host.notify({ kind: "recovered-folder", recoveries: shown });
    } catch (error) {
      this.#host.notify({ kind: "failed", action: "recover-folder", subject: folder.name, error });
    }
    await this.rescan();
  }

  watch(slot: Slot, path: FilePath, session: PageSession<FilePath>): void {
    this.#watcher?.watch(slot, path, session);
  }

  unwatch(slot: Slot): void {
    this.#watcher?.unwatch(slot);
  }

  /** List the folder again, keeping files known to be unreadable marked until they change. */
  async rescan(): Promise<readonly FolderFile[]> {
    const folder = this.folder;
    if (!folder) return [];
    this.#scanning = true;
    this.#publish();
    try {
      const scan = await scanFolder(folder.fs);
      if (this.folder !== folder) return [];
      this.#files = scan.files.map((f) => {
        const known = this.#unreadable.get(f.path);
        if (!known || f.unreadable) return f;
        if (known.modifiedAt !== f.modifiedAt) {
          this.#unreadable.delete(f.path);
          return f;
        }
        return { ...f, unreadable: known.reason, rows: null };
      });
      this.#partial = scan.partial;
      return this.#files;
    } catch (error) {
      // A folder that went away or lost access: find out which, which may leave `connected`.
      if (isFsError(error, "not-found") || isFsError(error, "not-allowed")) await this.access.restore();
      else this.#host.notify({ kind: "failed", action: "list-folder", subject: folder.name, error });
      return [];
    } finally {
      this.#scanning = false;
      this.#publish();
    }
  }

  /** A file couldn't be opened: show why in the list. */
  markUnreadable(path: FilePath, reason: UnreadableReason): void {
    this.#files = this.#files.map((f) => {
      if (f.path !== path) return f;
      this.#unreadable.set(f.path, { reason, modifiedAt: f.modifiedAt });
      return { ...f, unreadable: reason, rows: null };
    });
    this.#publish();
  }

  /** A file was saved: update its size, date, and (for context files) rows. */
  saved(path: FilePath, result: WriteResult<FilePath>, text: string): void {
    const rows = rowsUsed(layoutRows(text, TERMINAL_COLS));
    this.#files = this.#files.map((f) =>
      f.path === path
        ? { ...f, size: result.size, modifiedAt: result.modifiedAt, rows: f.group === "context" ? rows : f.rows }
        : f,
    );
    this.#publish();
  }

  /** Create a new file (never overwrites) and list the folder again. @throws on an invalid or taken path */
  async createFile(input: string, text: string): Promise<FilePath> {
    const folder = this.folder;
    if (!folder) throw new Error("Open a folder first.");
    const path = parseFilePath(input.trim());
    await folder.sheet.create(path, text);
    await this.rescan();
    return path;
  }

  /** Back from another app: check open files now, then the list. */
  async visible(): Promise<void> {
    if (!this.folder) return;
    await this.#watcher?.tick();
    await this.rescan();
  }

  /** Forget the folder (callers close its file sessions first). Returns leftover-draft copies. */
  async forget(): Promise<readonly PageName[]> {
    this.#watcher?.stop();
    this.#watcher = null;
    const { store, journal } = this.#host.library();
    const copies = await this.access.forget(store, journal, await this.#host.liveTabs());
    this.#files = [];
    this.#partial = false;
    this.#unreadable.clear();
    this.#publish();
    return copies;
  }

  dispose(): void {
    this.#stop();
    this.#watcher?.stop();
    this.#watcher = null;
  }
}
