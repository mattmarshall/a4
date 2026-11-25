/**
 * The workspace: the page library, the open folder, and the open pages
 * (slots A and B), as a plain controller.
 *
 * - React renders `getSnapshot()` (through `useSyncExternalStore`) and calls
 *   commands. Commands return a `Result`; nothing throws to the UI.
 * - Notices (recoveries, copies, failures) go to `subscribeNotices` as data.
 * - `start()` opens the store, takes this tab's lock, recovers drafts left by
 *   closed tabs, migrates the old slots, makes sure the Welcome page exists,
 *   reopens the remembered pages, and reconnects the remembered folder. It
 *   runs once per workspace, and can be retried after a failure.
 * - `dispose()` saves every open page and stops the watcher, the folder
 *   subscription, and the channel.
 *
 * Every browser API comes in through the platform ports, so all of this runs
 * in Node tests with fakes.
 */

import { recoverDrafts } from "../persist/autosave/bootstrap.ts";
import { ensureFirstPage, migrateLegacySlots } from "../persist/autosave/bootstrap.ts";
import { Journal } from "../persist/autosave/journal.ts";
import type { PageSessionOptions, Scheduler, SessionEvent } from "../persist/autosave/session.ts";
import { assertNever } from "../page/index.ts";
import type { ImportReport, LibraryArchive } from "../archive/index.ts";
import { FolderAccess, type ConnectedFolder } from "../persist/folder/access.ts";
import type { FolderSource } from "../persist/folder/fs.ts";
import { FolderRegistry } from "../persist/folder/registry.ts";
import type { LibraryEvent } from "../persist/library-events.ts";
import { LIBRARY_CHANNEL } from "../persist/library-events.ts";
import type { HandleStore } from "../platform/handle-store.ts";
import type { Platform } from "../platform/index.ts";
import { readSetting, setSettingsStorage, SETTINGS, writeSetting } from "../persist/settings.ts";
import { pageNameCodec, parsePageName } from "../persist/store/names.ts";
import { openPageStore, type OpenedStore } from "../persist/store/open.ts";
import { copyNameFor, fileRef, libraryRef, sameRef, type FilePath, type PageRef } from "../persist/store/refs.ts";
import {
  isLetterPath,
  letterPathAt,
  MAX_FILE_BYTES,
  type Postmark,
  PostmarkExistsError,
  postmarkPath,
  readPostmark,
  sealLetter,
  type SealOptions,
} from "../desk/index.ts";
import {
  FileUnreadableError,
  isStoreError,
  PageExistsError,
  type PageName,
  type PageSummary,
  type TrashId,
} from "../persist/store/types.ts";
import { FolderIndex } from "./folder-index.ts";
import { LibraryIndex } from "./library-index.ts";
import { shouldReopen, type PendingFile } from "./pending.ts";
import { openFolderFile, openLibraryPage, SlotController, type OpenPage } from "./slot-controller.ts";
import { SlotRequests, type Ticket } from "./slot-requests.ts";
import {
  attempt,
  ok,
  SLOTS,
  type FolderSnapshot,
  type Result,
  type Slot,
  type StorageInfo,
  type WorkspaceNotice,
  type WorkspaceSnapshot,
  type WorkspaceStatus,
} from "./types.ts";

export interface WorkspaceOptions<H> {
  platform: Platform;
  /** How picked folders are named, matched, and opened, and where their handles are kept. */
  folders: { readonly source: FolderSource<H>; readonly handles: HandleStore<H> };
  /** The Welcome page's text, created when the library is empty. */
  welcomeText: string;
  /** Texts the old single-page slots held by default; they aren't migrated. */
  skipMigration: readonly string[];
  /** Opens the page store (default: OPFS, else localStorage, else memory). */
  openStore?: () => Promise<OpenedStore>;
  /** Timers for autosave and the folder watcher (default: real timers). */
  scheduler?: Scheduler;
  /** Whether the tab is visible: the watcher polls only then (default: always). */
  isVisible?: () => boolean;
}

const NO_FOLDER: FolderSnapshot = {
  state: { status: "none" },
  files: [],
  letters: [],
  stacks: [],
  partial: false,
  scanning: false,
};

class NotReady extends Error {
  constructor() {
    super("Storage isn’t ready yet.");
    this.name = "NotReady";
  }
}

export class Workspace<H> {
  readonly #options: WorkspaceOptions<H>;
  readonly #platform: Platform;
  readonly #listeners = new Set<() => void>();
  readonly #noticeListeners = new Set<(notice: WorkspaceNotice) => void>();
  readonly #requests = new SlotRequests<Slot>();
  readonly #slots: Record<Slot, SlotController>;
  readonly #pending: Record<Slot, PendingFile | null> = { a: null, b: null };
  #status: WorkspaceStatus = { kind: "starting" };
  #storage: StorageInfo | null = null;
  #library: LibraryIndex | null = null;
  #folder: FolderIndex<H> | null = null;
  #starting: Promise<Result<void>> | null = null;
  #snapshot: WorkspaceSnapshot;
  #askedPersist = false;
  /** Whether slot B is shown (Compare); a file waiting for B reopens only then. */
  #compare = false;
  #disposed = false;

  constructor(options: WorkspaceOptions<H>) {
    this.#options = options;
    this.#platform = options.platform;
    const publish = () => this.#publish();
    this.#slots = { a: new SlotController("a", publish), b: new SlotController("b", publish) };
    this.#snapshot = this.#build();
  }

  // -------------------------------------------------------------------------
  // State

  getSnapshot = (): WorkspaceSnapshot => this.#snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  subscribeNotices(listener: (notice: WorkspaceNotice) => void): () => void {
    this.#noticeListeners.add(listener);
    return () => this.#noticeListeners.delete(listener);
  }

  #build(): WorkspaceSnapshot {
    return {
      status: this.#status,
      storage: this.#storage,
      library: { pages: this.#library?.pages ?? [], trash: this.#library?.trash ?? [] },
      slots: { a: this.#slots.a.snapshot, b: this.#slots.b.snapshot },
      folder: this.#folder?.snapshot ?? NO_FOLDER,
    };
  }

  #publish(): void {
    this.#snapshot = this.#build();
    for (const listener of this.#listeners) listener();
  }

  #notify(notice: WorkspaceNotice): void {
    for (const listener of this.#noticeListeners) listener(notice);
  }

  #need(): LibraryIndex {
    if (!this.#library) throw new NotReady();
    return this.#library;
  }

  #connected(): ConnectedFolder | null {
    return this.#folder?.folder ?? null;
  }

  #remember(slot: Slot, ref: PageRef | null): void {
    writeSetting(slot === "a" ? SETTINGS.openA : SETTINGS.openB, ref);
  }

  #slotOf(ref: PageRef): Slot | undefined {
    return SLOTS.find((s) => sameRef(this.#slots[s].open?.ref ?? null, ref));
  }

  // -------------------------------------------------------------------------
  // Startup and disposal

  /** Start once; after a failure, calling again retries. */
  start(): Promise<Result<void>> {
    this.#starting ??= attempt(() => this.#start()).then((result) => {
      if (!result.ok) {
        this.#starting = null;
        this.#status = { kind: "failed", error: result.error };
        this.#publish();
      }
      return result;
    });
    return this.#starting;
  }

  async #start(): Promise<void> {
    const platform = this.#platform;
    this.#status = { kind: "starting" };
    this.#publish();
    setSettingsStorage(platform.keyValue);
    const { store, movedFromFallback } = await (this.#options.openStore?.() ??
      openPageStore(platform.storage, { locks: platform.locks, clock: platform.clock }));
    const tabId = platform.randomId();
    platform.tabs.hold(tabId);
    const live = await platform.tabs.live();
    const journal = new Journal(platform.keyValue, tabId, pageNameCodec, { clock: platform.clock });
    const recoveries = await recoverDrafts(
      store,
      journal,
      { kind: "same-store", store },
      live,
      platform.clock.now(),
    ).catch(() => []);
    const migrated = await migrateLegacySlots(store, platform.keyValue, this.#options.skipMigration).catch(
      (): PageName[] => [],
    );
    try {
      await ensureFirstPage(store, this.#options.welcomeText);
    } catch (error) {
      if (!isStoreError(error, "exists")) throw error;
    }
    const persistent = await platform.storage.persisted();
    if (this.#disposed) return;

    const library = new LibraryIndex({
      store,
      journal,
      channel: platform.channel(LIBRARY_CHANNEL),
      onChange: () => this.#publish(),
      onRemote: (event) => void this.#remote(event),
    });
    this.#library = library;
    this.#storage = { kind: store.kind, durable: store.durable, persistent };
    const list = await library.refresh();

    // Reopen the remembered pages. A remembered file waits for its folder.
    const names = new Set<string>(list.map((p) => p.name));
    const fallback = list.find((p) => p.name === "Welcome")?.name ?? list[0]?.name ?? null;
    const savedA = readSetting(SETTINGS.openA);
    const savedB = readSetting(SETTINGS.openB);
    if (savedA?.kind === "file") {
      this.#pending.a = { ref: savedA, fallback: fallback ? libraryRef(fallback) : null };
      await this.#open("a", fallback ? libraryRef(fallback) : null, { remember: false });
    } else {
      const name = savedA && names.has(savedA.name) ? savedA.name : fallback;
      await this.#open("a", name ? libraryRef(name) : null);
    }
    if (savedB?.kind === "file") this.#pending.b = { ref: savedB, fallback: null };

    this.#status = { kind: "ready" };
    this.#publish();
    const recovered = recoveries.filter((r) => r.kind !== "discarded");
    if (recovered.length) this.#notify({ kind: "recovered-library", recoveries: recovered });
    if (migrated.length) this.#notify({ kind: "migrated", count: migrated.length });
    if (movedFromFallback) this.#notify({ kind: "moved-from-fallback", count: movedFromFallback });
    if (!store.durable) this.#notify({ kind: "not-durable" });

    await this.#attachFolder(tabId);
  }

  async #attachFolder(tabId: string): Promise<void> {
    const platform = this.#platform;
    const { source, handles } = this.#options.folders;
    const registry = new FolderRegistry<H>({ kv: platform.keyValue, handles, source, randomId: platform.randomId });
    const access = new FolderAccess<H>({
      registry,
      source,
      kv: platform.keyValue,
      tabId,
      supported: platform.folderPicker,
      locks: platform.locks,
      clock: platform.clock,
    });
    this.#folder = new FolderIndex<H>({
      access,
      scheduler: this.#options.scheduler,
      isVisible: this.#options.isVisible,
      host: {
        library: () => {
          const library = this.#need();
          return { store: library.store, journal: library.journal };
        },
        liveTabs: () => platform.tabs.live(),
        notify: (notice) => this.#notify(notice),
        changed: () => this.#publish(),
        reloaded: (slot, path, text) => {
          this.#slots[slot].adoptedFile(text);
          this.#notify({ kind: "reloaded", path });
        },
        lost: () => this.#folderLost(),
      },
    });
    this.#publish();
    const state = await access.restore();
    if (state.status === "connected") await this.#onConnected(state.folder);
  }

  /** Save every open page and stop. The workspace can't be used afterwards. */
  async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const slot of SLOTS) this.#requests.begin(slot);
    await Promise.all(SLOTS.map((slot) => this.#slots[slot].close()));
    this.#folder?.dispose();
    this.#library?.close();
    this.#listeners.clear();
    this.#noticeListeners.clear();
  }

  // -------------------------------------------------------------------------
  // Sessions

  #sessionOptions(): Omit<PageSessionOptions, "onEvent"> {
    return this.#options.scheduler ? { scheduler: this.#options.scheduler } : {};
  }

  /** Route a session's event to the slot that holds it now (slots can swap). */
  #route(open: () => OpenPage | null) {
    return (event: SessionEvent<string>) => {
      const built = open();
      const slot = SLOTS.find((s) => this.#slots[s].open === built);
      if (!built || !slot) return;
      void this.#onSessionEvent(slot, built, event);
    };
  }

  async #onSessionEvent(slot: Slot, open: OpenPage, event: SessionEvent<string>): Promise<void> {
    const controller = this.#slots[slot];
    const library = this.#library;
    if (!library) return;
    switch (event.type) {
      case "status":
        controller.status(event.status);
        break;
      case "saved":
        if (open.kind === "library") library.saved({ ...event.result, name: open.ref.name });
        else this.#folder?.saved(open.ref.path, { ...event.result, name: open.ref.path }, controller.text);
        break;
      case "conflict":
      case "recreated": {
        const copy = event.type === "conflict" ? event.copy : event.name;
        this.#notify(
          event.type === "conflict"
            ? { kind: "conflict", original: event.original, copy, moved: event.moved }
            : { kind: "recreated", original: event.original, name: copy, moved: event.moved },
        );
        if (event.moved) {
          await library.refresh().catch(() => {});
          await this.#followCopy(slot, copy);
        } else {
          controller.follow(copy);
          this.#remember(slot, libraryRef(copy));
          void library.refresh().catch(() => {});
        }
        library.changed();
        break;
      }
      case "error":
        break;
      default:
        assertNever(event);
    }
  }

  /** A file session stopped and its text is now a library page: open that page, keeping keys typed since. */
  async #followCopy(slot: Slot, copy: PageName): Promise<void> {
    const typed = this.#slots[slot].text;
    const result = await attempt(() => this.#open(slot, libraryRef(copy)));
    if (!result.ok) return;
    const controller = this.#slots[slot];
    if (controller.open?.kind === "library" && controller.open.session.text !== typed) controller.edit(typed);
  }

  /** Another tab changed the library: adopt a saved page shown here, unless it has unsaved edits. */
  async #remote(event: LibraryEvent | null): Promise<void> {
    if (event?.event.case !== "pageSaved") return;
    const { name } = event.event.value;
    const library = this.#library;
    if (!library) return;
    for (const slot of SLOTS) {
      const open = this.#slots[slot].open;
      if (open?.kind !== "library" || open.ref.name !== name) continue;
      try {
        this.#slots[slot].adoptLibraryPage(await library.store.read(open.ref.name));
      } catch {
        // Deleted elsewhere: the session recreates it on the next save.
      }
    }
  }

  // -------------------------------------------------------------------------
  // Opening pages

  /** Open a page or file in `slot`, saving whatever was there first. @throws when the page can't be read */
  async #open(
    slot: Slot,
    ref: PageRef | null,
    options: { remember?: boolean; ticket?: Ticket<Slot> } = {},
  ): Promise<void> {
    const library = this.#need();
    const ticket = options.ticket ?? this.#requests.begin(slot);
    const keep = options.remember ?? true;
    const other: Slot = slot === "a" ? "b" : "a";
    const here = this.#slots[slot];
    const there = this.#slots[other];
    if (ref && here.open && sameRef(here.open.ref, ref)) return;
    if (ref && there.open && sameRef(there.open.ref, ref)) {
      // A page is open in one slot at a time: exchange the two slots. This
      // also supersedes any open still pending for the other slot.
      this.#requests.begin(other);
      const mine = here.take();
      here.show(there.take());
      there.show(mine);
      for (const s of SLOTS) this.#remember(s, this.#slots[s].open?.ref ?? null);
      this.#rewatch();
      return;
    }

    // Read first, so a page that can't be opened leaves the slot as it was.
    let opened: OpenPage | null = null;
    if (ref?.kind === "library") {
      const page = await library.store.read(ref.name);
      opened = openLibraryPage(library, page, { ...this.#sessionOptions(), onEvent: this.#route(() => opened) });
    } else if (ref?.kind === "file") {
      const folder = this.#connected();
      if (!folder) throw new Error("Connect the folder to open its files.");
      let page: Awaited<ReturnType<ConnectedFolder["sheet"]["read"]>>;
      try {
        page = await folder.sheet.read(ref.path);
      } catch (error) {
        // Show why in the list, so the file reads as one that can't open.
        if (error instanceof FileUnreadableError) this.#folder?.markUnreadable(ref.path, error.reason);
        throw error;
      }
      const file = openFolderFile(library, folder, page, {
        ...this.#sessionOptions(),
        onEvent: this.#route(() => opened),
      });
      // A letter with a postmark is sealed: it opens read-only.
      const sealed = isLetterPath(ref.path) && (await folder.fs.stat(postmarkPath(ref.path))) !== null;
      opened = sealed && file.kind === "file" ? { ...file, readOnly: true } : file;
    }

    // A newer request for this slot began while we read: drop what we built.
    if (!ticket.current()) {
      await opened?.session.dispose();
      return;
    }
    // Save and close whatever the slot holds now (it may have changed while we read).
    const previous = here.take();
    if (previous) await previous.session.dispose();
    if (!ticket.current()) {
      await opened?.session.dispose();
      return;
    }
    this.#folder?.unwatch(slot);
    here.show(opened);
    if (opened?.kind === "file") this.#folder?.watch(slot, opened.ref.path, opened.session);
    if (keep) this.#remember(slot, opened?.ref ?? null);
  }

  /** Point the watcher at the files the slots show now. */
  #rewatch(): void {
    for (const slot of SLOTS) {
      const open = this.#slots[slot].open;
      if (open?.kind === "file") this.#folder?.watch(slot, open.ref.path, open.session);
      else this.#folder?.unwatch(slot);
    }
  }

  /** Open something else in the slots that showed `refs`: another recent page, or a new one for A. */
  async #replace(slots: readonly Slot[], list: readonly PageSummary[]): Promise<void> {
    for (const slot of slots) {
      const other = this.#slots[slot === "a" ? "b" : "a"].open?.ref;
      const next = list.find((p) => !(other?.kind === "library" && other.name === p.name))?.name ?? null;
      if (next) await this.#open(slot, libraryRef(next));
      else if (slot === "a") await this.#create("Untitled", "", "a");
      else this.#slots.b.show(null);
    }
  }

  async #create(desired: string, text: string, slot: Slot): Promise<PageName> {
    const name = await this.#need().create(desired, text);
    await this.#open(slot, libraryRef(name));
    return name;
  }

  // -------------------------------------------------------------------------
  // Commands: pages

  /** Record an edit in `slot`. The first edit asks the browser to keep storage. */
  edit(slot: Slot, text: string): void {
    this.#slots[slot].edit(text);
    if (!this.#askedPersist && this.#library) {
      this.#askedPersist = true;
      void this.#platform.storage.persist().then((persistent) => {
        if (persistent === null || !this.#storage) return;
        this.#storage = { ...this.#storage, persistent };
        this.#publish();
      });
    }
  }

  open(slot: Slot, target: PageRef | PageName | null, options: { remember?: boolean } = {}): Promise<Result<void>> {
    const ref = typeof target === "string" ? libraryRef(target) : target;
    return attempt(() => this.#open(slot, ref, options));
  }

  createPage(desired: string, text: string, slot: Slot = "a"): Promise<Result<PageName>> {
    return attempt(() => this.#create(desired, text, slot));
  }

  /** Rename a library page (following it in the slot that shows it). */
  renamePage(from: PageName, input: string): Promise<Result<void>> {
    return attempt(async () => {
      const library = this.#need();
      const to = parsePageName(input);
      if (to === from) return;
      const slot = this.#slotOf(libraryRef(from));
      const open = slot ? this.#slots[slot].open : null;
      if (slot && open?.kind === "library") {
        const result = await open.session.rename(to);
        this.#slots[slot].follow(result.name);
        this.#remember(slot, libraryRef(result.name));
        await library.refresh();
        library.changed();
      } else {
        await library.rename(from, to);
      }
    });
  }

  /** Copy a page or file into a new library page, opened in `slot` when given. */
  duplicatePage(target: PageRef | PageName, slot?: Slot): Promise<Result<PageName | null>> {
    return attempt(async () => {
      const library = this.#need();
      const ref = typeof target === "string" ? libraryRef(target) : target;
      const shownIn = this.#slotOf(ref);
      if (shownIn) await this.#slots[shownIn].flush();
      let text: string;
      if (ref.kind === "library") text = (await library.store.read(ref.name)).text;
      else {
        const folder = this.#connected();
        if (!folder) return null;
        text = (await folder.sheet.read(ref.path)).text;
      }
      const copy = await library.create(copyNameFor(ref, " copy"), text);
      if (slot) await this.#open(slot, libraryRef(copy));
      return copy;
    });
  }

  trashPage(name: PageName): Promise<Result<void>> {
    return attempt(async () => {
      const library = this.#need();
      const ref = libraryRef(name);
      const shown = SLOTS.filter((s) => sameRef(this.#slots[s].open?.ref ?? null, ref));
      for (const slot of shown) {
        this.#requests.begin(slot);
        await this.#slots[slot].close();
      }
      const list = await library.trashPage(name);
      this.#notify({ kind: "trashed", name });
      await this.#replace(shown, list);
    });
  }

  restorePage(id: TrashId): Promise<Result<void>> {
    return attempt(async () => {
      const name = await this.#need().restore(id);
      this.#notify({ kind: "restored", name });
    });
  }

  purgePages(ids: readonly TrashId[]): Promise<Result<void>> {
    return attempt(() => this.#need().purge(ids));
  }

  /** Show slot B (Compare): the remembered page, else another recent page, else a new one. */
  ensureSlotB(): Promise<Result<void>> {
    this.#compare = true;
    return attempt(async () => {
      if (this.#slots.b.open) return;
      const library = this.#need();
      const ticket = this.#requests.begin("b");
      const list = await library.refresh();
      // Compare was left, or something else opened in B, while the list loaded.
      if (!ticket.current() || this.#slots.b.open) return;
      const a = this.#slots.a.open?.ref ?? null;
      const saved = readSetting(SETTINGS.openB);
      const pending = this.#pending.b;
      const wanted = saved ?? pending?.ref ?? null;
      if (wanted?.kind === "file" && this.#connected() && !sameRef(wanted, a)) {
        const opened = await attempt(async () => {
          this.#pending.b = null;
          await this.#open("b", wanted, { ticket });
        });
        if (opened.ok) return;
        // The file is gone or unreadable: fall back to a library page.
      }
      const notA = (p: PageSummary) => !(a?.kind === "library" && a.name === p.name);
      const pick =
        (wanted?.kind === "library" ? list.find((p) => p.name === wanted.name && notA(p))?.name : undefined) ??
        list.find(notA)?.name ??
        null;
      if (!ticket.current()) return;
      // A remembered file whose folder isn't connected yet: show a library page
      // meanwhile, without forgetting the file, and reopen it on connect.
      const waiting = wanted?.kind === "file" && !this.#connected() && !sameRef(wanted, a);
      if (pick) {
        await this.#open("b", libraryRef(pick), { ticket, remember: !waiting });
        if (waiting && ticket.current()) this.#pending.b = { ref: wanted, fallback: libraryRef(pick) };
      } else {
        // Only one page exists: make an empty one for B, unless Compare was left meanwhile.
        if (!ticket.current()) return;
        const { name } = await library.store.createUnique("Untitled", "");
        await library.refresh();
        library.changed();
        await this.#open("b", libraryRef(name), { ticket });
      }
    });
  }

  /** Hide slot B (leaving Compare), saving it first. */
  async closeSlotB(): Promise<void> {
    this.#compare = false;
    // Supersede any open still pending for B, even if nothing is open yet.
    const ticket = this.#requests.begin("b");
    const open = this.#slots.b.open;
    if (!open) return;
    await open.session.dispose();
    // Compare may have been entered again while B saved: leave the new page alone.
    if (!ticket.current() || this.#slots.b.open !== open) return;
    this.#slots.b.show(null);
    this.#folder?.unwatch("b");
  }

  /** Exchange the pages in A and B. */
  async swapSlots(): Promise<Result<void>> {
    const b = this.#slots.b.open?.ref;
    if (!this.#slots.a.open || !b) return ok(undefined);
    return attempt(() => this.#open("a", b));
  }

  /** Save every open page now. True only if every one is saved. */
  async flushAll(): Promise<boolean> {
    await Promise.all(SLOTS.map((slot) => this.#slots[slot].flush()));
    return SLOTS.every((slot) => this.#slots[slot].saved);
  }

  /** Save pending edits, then zip every library page (not the trash, not folder files). */
  exportAll(): Promise<Result<LibraryArchive>> {
    return attempt(async () => {
      const library = this.#need();
      await this.flushAll();
      return library.exportAll();
    });
  }

  /** Import pages from a zip; never changes existing pages. */
  importArchive(bytes: Uint8Array): Promise<Result<ImportReport>> {
    return attempt(() => this.#need().importArchive(bytes));
  }

  // -------------------------------------------------------------------------
  // Commands: the folder

  /** The folder connected: recover, list, watch, and reopen remembered files. */
  async #onConnected(folder: ConnectedFolder): Promise<void> {
    const index = this.#folder;
    if (!index) return;
    await index.attach(folder);
    for (const slot of SLOTS) {
      const pending = this.#pending[slot];
      if (!pending) continue;
      const current = this.#slots[slot].open?.ref ?? null;
      const showing = slot === "a" || this.#compare;
      if (!shouldReopen(slot, pending, current) && !(showing && current === null)) {
        // B isn't showing yet (Single view): Compare opens the file later.
        if (slot === "b" && !pending.fallback) continue;
        this.#pending[slot] = null;
        continue;
      }
      this.#pending[slot] = null;
      const result = await attempt(() => this.#open(slot, pending.ref));
      if (!result.ok && !isStoreError(result.error, "not-found")) {
        this.#notify({ kind: "failed", action: "reopen-file", subject: null, error: result.error });
      }
    }
    this.#rewatch();
  }

  /** Access was lost (the folder moved, or permission went): close file sessions, keeping drafts. */
  async #folderLost(): Promise<void> {
    for (const slot of SLOTS) {
      const open = this.#slots[slot].open;
      if (open?.kind !== "file") continue;
      this.#requests.begin(slot);
      // Remember the file, so it reopens when access returns.
      this.#pending[slot] = { ref: open.ref, fallback: null };
      // Disposing flushes; a save that fails leaves the draft in the journal.
      await this.#slots[slot].close();
    }
  }

  /** Remember and connect a folder the author picked, replacing the open one. */
  openFolder(handle: H): Promise<Result<void>> {
    return attempt(async () => {
      const index = this.#folder;
      if (!index) throw new NotReady();
      const status = index.access.state.status;
      if (status !== "none" && status !== "unsupported") {
        const closed = await this.closeFolder();
        if (!closed.ok) throw closed.error;
      }
      const state = await index.access.open(handle);
      if (state.status === "connected") await this.#onConnected(state.folder);
    });
  }

  /** Ask for access to the remembered folder again (from a click). */
  reconnectFolder(): Promise<Result<void>> {
    return attempt(async () => {
      const index = this.#folder;
      if (!index) throw new NotReady();
      const state = await index.access.reconnect();
      if (state.status === "connected") await this.#onConnected(state.folder);
      else if (state.status === "reconnect") this.#notify({ kind: "still-no-access", folder: state.name });
    });
  }

  /** Close open files (after saving), and forget the folder. Leftover drafts become library pages. */
  closeFolder(): Promise<Result<void>> {
    return attempt(async () => {
      const library = this.#need();
      const index = this.#folder;
      if (!index) return;
      const fileSlots = SLOTS.filter((s) => this.#slots[s].open?.kind === "file");
      for (const slot of fileSlots) {
        this.#requests.begin(slot);
        await this.#slots[slot].close();
      }
      this.#pending.a = null;
      this.#pending.b = null;
      const copies = await index.forget();
      const list = await library.refresh();
      if (copies.length) this.#notify({ kind: "folder-copies", copies });
      await this.#replace(fileSlots, list);
    });
  }

  /** Close what `slot` shows and open `ref` again (to pick up a seal). */
  async #reopen(slot: Slot, ref: PageRef): Promise<void> {
    this.#folder?.unwatch(slot);
    const previous = this.#slots[slot].take();
    await previous?.session.dispose();
    await this.#open(slot, ref);
  }

  /**
   * Seal the letter `slot` shows: save its pending edits, write its postmark
   * under the folder's lock for that postmark, list the folder again, and
   * reopen the letter read-only. A letter sealed meanwhile (another tab) is
   * refused and shown as it is now.
   */
  sealLetter(slot: Slot, seal: Omit<SealOptions, "now">): Promise<Result<Postmark>> {
    return attempt(async () => {
      const open = this.#slots[slot].open;
      const folder = this.#connected();
      if (!folder || open?.kind !== "file" || !isLetterPath(open.ref.path))
        throw new Error("Open a letter to seal it.");
      if (open.readOnly) throw new PostmarkExistsError(open.ref.path);
      await this.#slots[slot].flush();
      if (!this.#slots[slot].saved) throw new Error("The letter couldn’t be saved, so it wasn’t sealed.");
      const { path } = open.ref;
      const { locks, clock } = this.#platform;
      const write = () => sealLetter(folder.fs, path, { ...seal, now: clock.now() });
      /** List the folder again, and show the letter as it is now (read-only once sealed). */
      const refresh = async () => {
        await this.#folder?.rescan();
        if (this.#slots[slot].open === open) await this.#reopen(slot, open.ref);
      };
      let postmark: Postmark;
      try {
        // Without Web Locks (one tab), the desk's own "already sealed" check still holds.
        postmark = await (locks ? locks.request(`a4:file:${folder.id}:${postmarkPath(path)}`, write) : write());
      } catch (error) {
        if (error instanceof PostmarkExistsError) await refresh();
        throw error;
      }
      await refresh();
      return postmark;
    });
  }

  /**
   * The sealed letter `slot` shows, for a share link: the file's exact bytes
   * (so the link's seal can be checked against its digest) and its postmark.
   * Null for anything else: a draft, a library page, or a letter whose
   * postmark can't be read. Reads at most 1 MiB.
   */
  letterForShare(slot: Slot): Promise<Result<{ bytes: Uint8Array; postmark: Postmark } | null>> {
    return attempt(async () => {
      const open = this.#slots[slot].open;
      const folder = this.#connected();
      if (!folder || open?.kind !== "file" || !open.readOnly || !isLetterPath(open.ref.path)) return null;
      const { path } = open.ref;
      const name = path.slice(path.lastIndexOf("/") + 1);
      const letter = await folder.fs.readBytes(path, { maxBytes: MAX_FILE_BYTES });
      const sidecar = await folder.fs.readBytes(postmarkPath(path), { maxBytes: 64 * 1024 });
      const postmark = readPostmark(sidecar.bytes, name);
      if (!letter.bytes || !postmark) return null;
      return { bytes: letter.bytes, postmark };
    });
  }

  /**
   * Start a letter: create `.agents/letters/<UTC YYYY-MM-DD-HHMM>-letter.md`
   * (numbered when that name is taken) holding `text`, and open it in `slot`.
   */
  createLetter(text: string, slot: Slot): Promise<Result<FilePath>> {
    return attempt(async () => {
      const index = this.#folder;
      if (!index) throw new Error("Open a folder first.");
      const now = this.#platform.clock.now();
      // Creating a file adds its final newline; a form's own last newline would make two.
      const body = text.endsWith("\n") ? text.slice(0, -1) : text;
      for (let n = 1; n <= 9; n++) {
        let path: FilePath;
        try {
          path = await index.createFile(letterPathAt(now, n), body);
        } catch (error) {
          if (error instanceof PageExistsError) continue;
          throw error;
        }
        await this.#open(slot, fileRef(path));
        return path;
      }
      throw new Error("Couldn’t find a free name for a new letter this minute.");
    });
  }

  /** Create a file in the folder (never overwrites) and open it in `slot`. */
  createFile(input: string, text: string, slot: Slot): Promise<Result<FilePath>> {
    return attempt(async () => {
      const index = this.#folder;
      if (!index) throw new Error("Open a folder first.");
      const path = await index.createFile(input, text);
      await this.#open(slot, fileRef(path));
      return path;
    });
  }

  /**
   * Write the library page `name` to a new file, and open the file in the
   * slot that shows the page (or in `slot`). The page is the one Save to
   * folder was chosen for, whatever the slot shows by the time the path is
   * submitted.
   */
  saveToFolder(name: PageName, input: string, slot: Slot): Promise<Result<FilePath>> {
    return attempt(async () => {
      const library = this.#need();
      const shownIn = this.#slotOf(libraryRef(name));
      if (shownIn) await this.#slots[shownIn].flush();
      const text = (await library.store.read(name)).text;
      const index = this.#folder;
      if (!index) throw new Error("Open a folder first.");
      const path = await index.createFile(input, text);
      await this.#open(shownIn ?? slot, fileRef(path));
      this.#notify({ kind: "saved-to-folder", name, path: input.trim() });
      return path;
    });
  }

  // -------------------------------------------------------------------------
  // The tab

  /** The tab was hidden or is closing: save now (the journal covers what can't finish). */
  hidden(): Promise<boolean> {
    return this.flushAll();
  }

  /** The tab is visible again: check open files and list the folder. */
  async visible(): Promise<void> {
    await this.#folder?.visible();
  }
}
