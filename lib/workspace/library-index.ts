/**
 * The page library as the workspace sees it: the page and trash lists, store
 * actions that don't involve an open slot, and LibraryEvents over the channel
 * to this origin's other tabs.
 */

import type { Journal } from "../persist/autosave/journal.ts";
import { buildLibraryArchive, importZip, type ImportReport, type LibraryArchive } from "../archive/index.ts";
import {
  decodeLibraryEvent,
  encodeLibraryEvent,
  pageSaved,
  pagesChanged,
  type LibraryEvent,
} from "../persist/library-events.ts";
import type { Channel } from "../platform/channel.ts";
import { availableName } from "../persist/store/names.ts";
import {
  isStoreError,
  type PageName,
  type PageStore,
  type PageSummary,
  type TrashEntry,
  type TrashId,
  type WriteResult,
} from "../persist/store/types.ts";

function byRecent(pages: readonly PageSummary[]): PageSummary[] {
  return [...pages].sort((a, b) => b.modifiedAt - a.modifiedAt || a.name.localeCompare(b.name));
}

export class LibraryIndex {
  readonly store: PageStore;
  /** This tab's library journal. */
  readonly journal: Journal<PageName>;
  readonly #channel: Channel | null;
  readonly #stop: () => void;
  readonly #onChange: () => void;
  #pages: readonly PageSummary[] = [];
  #trash: readonly TrashEntry[] = [];

  constructor(options: {
    store: PageStore;
    journal: Journal<PageName>;
    channel: Channel | null;
    /** The lists changed. */
    onChange: () => void;
    /** Another tab posted an event (after the lists refreshed). */
    onRemote: (event: LibraryEvent | null) => void;
  }) {
    this.store = options.store;
    this.journal = options.journal;
    this.#channel = options.channel;
    this.#onChange = options.onChange;
    this.#stop =
      options.channel?.subscribe(async (data) => {
        const event = decodeLibraryEvent(data);
        await this.refresh().catch(() => {});
        options.onRemote(event);
      }) ?? (() => {});
  }

  get pages(): readonly PageSummary[] {
    return this.#pages;
  }

  get trash(): readonly TrashEntry[] {
    return this.#trash;
  }

  /** Read the lists again (most recent first). */
  async refresh(): Promise<readonly PageSummary[]> {
    const [list, trashed] = await Promise.all([this.store.list(), this.store.listTrash()]);
    this.#pages = byRecent(list);
    this.#trash = [...trashed].sort((x, y) => y.trashedAt - x.trashedAt);
    this.#onChange();
    return this.#pages;
  }

  #post(event: LibraryEvent): void {
    try {
      this.#channel?.post(encodeLibraryEvent(event));
    } catch {
      // Channel closed; other tabs will refresh on their next action.
    }
  }

  /** The page list changed: tell the other tabs. */
  changed(): void {
    this.#post(pagesChanged());
  }

  /** A page was saved: update its list entry, and tell the other tabs. */
  saved(result: WriteResult): void {
    this.#pages = byRecent(
      this.#pages.map((p) => (p.name === result.name ? { ...p, size: result.size, modifiedAt: result.modifiedAt } : p)),
    );
    this.#onChange();
    this.#post(pageSaved(result.name));
  }

  /** Create a page under `desired` or a unique variant of it. */
  async create(desired: string, text: string): Promise<PageName> {
    const name = await availableName(this.store, desired);
    await this.store.create(name, text);
    await this.refresh();
    this.changed();
    return name;
  }

  async rename(from: PageName, to: PageName): Promise<void> {
    await this.store.rename(from, to);
    await this.refresh();
    this.changed();
  }

  async trashPage(name: PageName): Promise<readonly PageSummary[]> {
    await this.store.trash(name);
    const list = await this.refresh();
    this.changed();
    return list;
  }

  async restore(id: TrashId): Promise<PageName> {
    const result = await this.store.restore(id);
    await this.refresh();
    this.changed();
    return result.name;
  }

  /** Permanently delete trashed pages; ones already gone are skipped. */
  async purge(ids: readonly TrashId[]): Promise<void> {
    for (const id of ids) {
      try {
        await this.store.purge(id);
      } catch (error) {
        if (!isStoreError(error, "not-found")) throw error;
      }
    }
    await this.refresh();
    this.changed();
  }

  /** Every page as a zip (not the trash). Callers flush open pages first. */
  exportAll(): Promise<LibraryArchive> {
    return buildLibraryArchive(this.store);
  }

  /** Import pages from a zip; never changes existing pages. @throws ZipError */
  async importArchive(bytes: Uint8Array): Promise<ImportReport> {
    try {
      return await importZip(this.store, bytes);
    } finally {
      // Refresh even after a partial import so every created page is visible.
      await this.refresh();
      this.changed();
    }
  }

  close(): void {
    this.#stop();
    this.#channel?.close();
  }
}
