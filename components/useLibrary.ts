"use client";

/**
 * useLibrary: the page library, the open folder, and the open pages (slots A
 * and B).
 *
 * Owns the PageStore, one PageSession per open slot, startup recovery and
 * migration, cross-tab refresh (BroadcastChannel), and flush-on-hide. A slot
 * holds a page reference: a library page, or a file in the open folder. File
 * sessions read and write sheet text through the faithful adapter, and their
 * copies (conflicts, deleted files) go to the library. UI code talks to pages
 * only through the actions returned here.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ensureFirstPage,
  Journal,
  migrateLegacySlots,
  PageSession,
  recoverDrafts,
  realScheduler,
  type Recovery,
  type SaveStatus,
  type SessionEvent,
} from "@/lib/autosave";
import { buildLibraryArchive, type LibraryArchive } from "@/lib/export";
import { FolderConnection, IdbHandleStore, type ConnectedFolder, type FolderState } from "@/lib/folder/connection";
import { scanFolder, type FolderFile } from "@/lib/folder/scan";
import { FileWatcher } from "@/lib/folder/watch";
import { shouldReopen, type PendingFile } from "@/lib/workspace/pending";
import { SlotRequests, type Ticket } from "@/lib/workspace/slot-requests";
import { importZip, type ImportReport } from "@/lib/import";
import { INCIDENT_JSON, INCIDENT_NARRATIVE, TEMPLATES, WELCOME } from "@/lib/samples";
import { browserKeyValue, KEYS, readKey, writeKey } from "@/lib/storage";
import {
  availableName,
  copyNameFor,
  decodeRef,
  encodeRef,
  fileCopyName,
  FileUnreadableError,
  fileRef,
  folderPickerSupported,
  isStoreError,
  libraryRef,
  openPageStore,
  parseFilePath,
  parsePageName,
  refLabel,
  sameRef,
  type FilePath,
  type KeyValue,
  type PageName,
  type PageRef,
  type PageStore,
  type PageSummary,
  type StoreKind,
  type TrashEntry,
  type TrashId,
  type UnreadableReason,
} from "@/lib/store";
import { layoutRows, rowsUsed } from "@/lib/text";
import { PRESETS } from "@/lib/page-spec";

export type Slot = "a" | "b";

export interface SlotState {
  /** What is open: a library page or a folder file. */
  ref: PageRef | null;
  /** The library page's name; null for a file. */
  name: PageName | null;
  /** The page name or the file path, for display. */
  label: string | null;
  text: string;
  status: SaveStatus;
}

export interface StorageInfo {
  kind: StoreKind;
  durable: boolean;
  persistent: boolean | null;
}

export interface FolderView {
  state: FolderState;
  files: FolderFile[];
  partial: boolean;
  scanning: boolean;
}

export type Notify = (message: string, tone?: "info" | "warn") => void;

const EMPTY_SLOT: SlotState = { ref: null, name: null, label: null, text: "", status: "saved" };
const CHANNEL = "a4-pages";
const SKIP_MIGRATION = [WELCOME, INCIDENT_JSON, INCIDENT_NARRATIVE, ...TEMPLATES.map((t) => t.text)];
const SLOTS = ["a", "b"] as const;

type AnySession = PageSession<PageName> | PageSession<FilePath>;
interface OpenPage {
  ref: PageRef;
  session: AnySession;
}

interface Boot {
  store: PageStore;
  journal: Journal;
  kv: KeyValue;
  tabId: string;
  recoveries: Recovery[];
  migrated: PageName[];
  movedFromFallback: number;
  persistent: boolean | null;
}

function refPatch(ref: PageRef | null): Pick<SlotState, "ref" | "name" | "label"> {
  return { ref, name: ref?.kind === "library" ? ref.name : null, label: ref ? refLabel(ref) : null };
}

/** The ids of all live tabs (from Web Locks), or null when unknown. */
async function liveTabs(): Promise<Set<string> | null> {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (!locks) return null;
  try {
    const snapshot = await locks.query();
    const names = [...(snapshot.held ?? []), ...(snapshot.pending ?? [])].map((l) => l.name ?? "");
    return new Set(names.filter((n) => n.startsWith("a4:tab:")).map((n) => n.slice("a4:tab:".length)));
  } catch {
    return null;
  }
}

/** Hold a Web Lock for this tab's lifetime; return the ids of all live tabs. */
async function holdTabLock(tabId: string): Promise<Set<string> | null> {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (!locks) return null;
  void locks.request(`a4:tab:${tabId}`, () => new Promise<void>(() => {}));
  return liveTabs();
}

let bootPromise: Promise<Boot> | null = null;

/** Runs once per page load (safe under React StrictMode double effects). */
function boot(): Promise<Boot> {
  bootPromise ??= (async () => {
    const { store, movedFromFallback } = await openPageStore();
    const kv = browserKeyValue();
    const tabId = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `t${Date.now()}`;
    const live = await holdTabLock(tabId);
    const journal = new Journal(kv, tabId);
    const recoveries = await recoverDrafts(store, journal, live).catch(() => [] as Recovery[]);
    const migrated = await migrateLegacySlots(store, kv, SKIP_MIGRATION).catch(() => [] as PageName[]);
    try {
      await ensureFirstPage(store, WELCOME);
    } catch (error) {
      if (!isStoreError(error, "exists")) throw error;
    }
    let persistent: boolean | null = null;
    try {
      persistent = (await navigator.storage?.persisted?.()) ?? null;
    } catch {
      persistent = null;
    }
    return { store, journal, kv, tabId, recoveries, migrated, movedFromFallback, persistent };
  })();
  return bootPromise;
}

function byRecent(pages: PageSummary[]): PageSummary[] {
  return [...pages].sort((a, b) => b.modifiedAt - a.modifiedAt || a.name.localeCompare(b.name));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorName(error: unknown): string | undefined {
  return typeof error === "object" && error !== null ? (error as { name?: string }).name : undefined;
}

const TERMINAL_COLS = PRESETS.terminal.cols;

export function useLibrary(notify: Notify) {
  const [ready, setReady] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [pages, setPages] = useState<PageSummary[]>([]);
  const [trash, setTrash] = useState<TrashEntry[]>([]);
  const [slotA, setSlotA] = useState<SlotState>(EMPTY_SLOT);
  const [slotB, setSlotB] = useState<SlotState>(EMPTY_SLOT);
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const [folderState, setFolderState] = useState<FolderState>({ status: "none" });
  const [folderFiles, setFolderFiles] = useState<FolderFile[]>([]);
  const [folderPartial, setFolderPartial] = useState(false);
  const [scanning, setScanning] = useState(false);

  const bootRef = useRef<Boot | null>(null);
  const sessions = useRef<Record<Slot, OpenPage | null>>({ a: null, b: null });
  /** The last request to change each slot wins (see SlotRequests). */
  const requests = useRef(new SlotRequests<Slot>());
  const latestText = useRef<Record<Slot, string>>({ a: "", b: "" });
  const channel = useRef<BroadcastChannel | null>(null);
  const askedPersist = useRef(false);
  const connectionRef = useRef<FolderConnection | null>(null);
  const watcherRef = useRef<FileWatcher | null>(null);
  /** File slots remembered from the last visit, waiting for the folder to connect. */
  const pendingFiles = useRef<Record<Slot, PendingFile | null>>({ a: null, b: null });
  /** Files that failed to open, kept across rescans until they change on disk. */
  const unreadable = useRef(new Map<string, { reason: UnreadableReason; modifiedAt: number }>());
  const notifyRef = useRef(notify);
  notifyRef.current = notify;

  const setSlot = useCallback((slot: Slot, patch: Partial<SlotState>) => {
    (slot === "a" ? setSlotA : setSlotB)((s) => ({ ...s, ...patch }));
  }, []);

  const connected = useCallback((): ConnectedFolder | null => {
    const state = connectionRef.current?.state;
    return state?.status === "connected" ? state.folder : null;
  }, []);

  const broadcast = useCallback((name: string) => {
    try {
      channel.current?.postMessage(name);
    } catch {
      // Channel closed; other tabs will refresh on their next action.
    }
  }, []);

  const refresh = useCallback(async () => {
    const b = bootRef.current;
    if (!b) return [] as PageSummary[];
    const [list, trashed] = await Promise.all([b.store.list(), b.store.listTrash()]);
    const sorted = byRecent(list);
    setPages(sorted);
    setTrash([...trashed].sort((x, y) => y.trashedAt - x.trashedAt));
    return sorted;
  }, []);

  const rescan = useCallback(async () => {
    const folder = connected();
    if (!folder) return [] as FolderFile[];
    setScanning(true);
    try {
      const scan = await scanFolder(folder.handle);
      if (connected() !== folder) return [] as FolderFile[];
      const files = scan.files.map((f) => {
        const known = unreadable.current.get(f.path);
        if (!known || f.unreadable) return f;
        if (known.modifiedAt !== f.modifiedAt) {
          unreadable.current.delete(f.path);
          return f;
        }
        return { ...f, unreadable: known.reason, rows: null };
      });
      setFolderFiles(files);
      setFolderPartial(scan.partial);
      return files;
    } catch (error) {
      if (errorName(error) === "NotFoundError" || errorName(error) === "NotAllowedError") {
        await connectionRef.current?.restore();
      } else {
        notifyRef.current(`Couldn’t list the folder: ${errorMessage(error)}`, "warn");
      }
      return [] as FolderFile[];
    } finally {
      setScanning(false);
    }
  }, [connected]);

  const remember = useCallback((slot: Slot, ref: PageRef | null) => {
    writeKey(slot === "a" ? KEYS.openA : KEYS.openB, encodeRef(ref));
  }, []);

  /** Re-point the file watcher at whatever files the slots hold now. */
  const rewatch = useCallback(() => {
    const watcher = watcherRef.current;
    if (!watcher) return;
    for (const slot of SLOTS) {
      const open = sessions.current[slot];
      if (open?.ref.kind === "file") watcher.watch(slot, open.ref.path, open.session as PageSession<FilePath>);
      else watcher.unwatch(slot);
    }
  }, []);

  // Assigned below; session events need to open copies.
  const openRef = useRef<
    (slot: Slot, target: PageRef | PageName | null, options?: { remember?: boolean }) => Promise<void>
  >(async () => {});

  /** A file session stopped and its text is now a library page: open that page in the slot. */
  const followCopy = useCallback(
    async (slot: Slot, copy: PageName) => {
      const typed = latestText.current[slot];
      await openRef.current(slot, libraryRef(copy));
      const open = sessions.current[slot];
      if (open && open.session.text !== typed) {
        (open.session as PageSession<PageName>).update(typed);
        setSlot(slot, { text: typed, status: open.session.status });
      }
    },
    [setSlot],
  );

  const onSessionEvent = useCallback(
    (slot: Slot, ref: PageRef, event: SessionEvent<string>) => {
      switch (event.type) {
        case "status":
          setSlot(slot, { status: event.status });
          break;
        case "saved":
          if (ref.kind === "library") {
            setPages((list) =>
              byRecent(
                list.map((p) =>
                  p.name === event.result.name
                    ? { ...p, size: event.result.size, modifiedAt: event.result.modifiedAt }
                    : p,
                ),
              ),
            );
            broadcast(event.result.name);
          } else {
            const text = sessions.current[slot]?.session.text ?? "";
            const rows = rowsUsed(layoutRows(text, TERMINAL_COLS));
            setFolderFiles((files) =>
              files.map((f) =>
                f.path === ref.path
                  ? {
                      ...f,
                      size: event.result.size,
                      modifiedAt: event.result.modifiedAt,
                      rows: f.group === "context" ? rows : f.rows,
                    }
                  : f,
              ),
            );
          }
          break;
        case "conflict":
          if (event.moved) {
            notifyRef.current(
              `“${event.original}” changed on disk, so your version was saved in the library as “${event.copy}”. The file was not changed.`,
              "warn",
            );
            void refresh().then(() => followCopy(slot, event.copy));
          } else {
            setSlot(slot, refPatch(libraryRef(event.copy)));
            const open = sessions.current[slot];
            if (open) open.ref = libraryRef(event.copy);
            remember(slot, libraryRef(event.copy));
            notifyRef.current(
              `“${event.original}” was changed in another tab. Your version was saved as “${event.copy}”.`,
              "warn",
            );
            void refresh();
          }
          broadcast("");
          break;
        case "recreated":
          if (event.moved) {
            notifyRef.current(
              `“${event.original}” was deleted on disk, so your edits were saved in the library as “${event.name}”.`,
              "warn",
            );
            void refresh().then(() => followCopy(slot, event.name));
          } else {
            setSlot(slot, refPatch(libraryRef(event.name)));
            const open = sessions.current[slot];
            if (open) open.ref = libraryRef(event.name);
            remember(slot, libraryRef(event.name));
            notifyRef.current(
              `“${event.original}” was deleted elsewhere, so your edits were saved as “${event.name}”.`,
              "warn",
            );
            void refresh();
          }
          broadcast("");
          break;
        case "error":
          break;
      }
    },
    [broadcast, followCopy, refresh, remember, setSlot],
  );

  /** Open a page or file in `slot`, saving whatever was open there first. */
  const openInSlot = useCallback(
    async (
      slot: Slot,
      target: PageRef | PageName | null,
      options: { remember?: boolean; ticket?: Ticket<Slot> } = {},
    ): Promise<void> => {
      const b = bootRef.current;
      if (!b) return;
      const ticket = options.ticket ?? requests.current.begin(slot);
      const ref: PageRef | null = typeof target === "string" ? libraryRef(target) : target;
      const keep = options.remember ?? true;
      const other: Slot = slot === "a" ? "b" : "a";
      const current = sessions.current[slot];
      if (ref && current && sameRef(current.ref, ref)) return;
      if (ref && sessions.current[other] && sameRef(sessions.current[other]!.ref, ref)) {
        // A page can be open in one slot only: exchange the two slots. This
        // also supersedes any open still pending for the other slot.
        requests.current.begin(other);
        sessions.current[slot] = sessions.current[other];
        sessions.current[other] = current;
        for (const s of SLOTS) {
          const open = sessions.current[s];
          latestText.current[s] = open?.session.text ?? "";
          setSlot(
            s,
            open ? { ...refPatch(open.ref), text: open.session.text, status: open.session.status } : EMPTY_SLOT,
          );
          remember(s, open?.ref ?? null);
        }
        rewatch();
        return;
      }

      // Read first, so a file that can't be opened leaves the slot as it was.
      let session: AnySession | null = null;
      let text = "";
      if (ref?.kind === "library") {
        const page = await b.store.read(ref.name);
        text = page.text;
        const s: PageSession<PageName> = new PageSession<PageName>({
          store: b.store,
          journal: b.journal,
          page,
          onEvent: (e) => {
            const at = SLOTS.find((x) => sessions.current[x]?.session === s);
            if (at) onSessionEvent(at, sessions.current[at]!.ref, e);
          },
        });
        session = s;
      } else if (ref?.kind === "file") {
        const folder = connected();
        if (!folder) throw new Error("Connect the folder to open its files.");
        let page: Awaited<ReturnType<typeof folder.sheet.read>>;
        try {
          page = await folder.sheet.read(ref.path);
        } catch (error) {
          // Show why in the list, so the file reads as one that can't open.
          if (error instanceof FileUnreadableError) {
            const reason = error.reason;
            setFolderFiles((files) =>
              files.map((f) => {
                if (f.path !== ref.path) return f;
                unreadable.current.set(f.path, { reason, modifiedAt: f.modifiedAt });
                return { ...f, unreadable: reason, rows: null };
              }),
            );
          }
          throw error;
        }
        text = page.text;
        const s: PageSession<FilePath> = new PageSession<FilePath>({
          store: folder.sheet,
          journal: folder.journal,
          page,
          copies: b.store,
          copiesJournal: b.journal,
          copyName: fileCopyName,
          onEvent: (e) => {
            const at = SLOTS.find((x) => sessions.current[x]?.session === s);
            if (at) onSessionEvent(at, sessions.current[at]!.ref, e);
          },
        });
        session = s;
      }

      // A newer request for this slot began while we read: drop what we built.
      if (!ticket.current()) {
        await session?.dispose();
        return;
      }
      // Save and close whatever the slot holds now (it may have changed while we read).
      const previous = sessions.current[slot];
      if (previous) await previous.session.dispose();
      if (!ticket.current()) {
        await session?.dispose();
        return;
      }
      watcherRef.current?.unwatch(slot);
      sessions.current[slot] = ref && session ? { ref, session } : null;
      latestText.current[slot] = text;
      if (!ref || !session) {
        setSlot(slot, EMPTY_SLOT);
        if (keep) remember(slot, null);
        return;
      }
      if (ref.kind === "file") watcherRef.current?.watch(slot, ref.path, session as PageSession<FilePath>);
      // The session may have resumed a draft this tab left (its last save failed).
      latestText.current[slot] = session.text;
      setSlot(slot, { ...refPatch(ref), text: session.text, status: session.status });
      if (keep) remember(slot, ref);
    },
    [connected, onSessionEvent, remember, rewatch, setSlot],
  );
  openRef.current = openInSlot;

  /** After the folder connects: recover its drafts, list it, and reopen remembered files. */
  const onConnected = useCallback(
    async (folder: ConnectedFolder) => {
      const b = bootRef.current;
      if (!b) return;
      watcherRef.current?.stop();
      watcherRef.current = new FileWatcher({
        folder,
        scheduler: realScheduler,
        isVisible: () => typeof document === "undefined" || document.visibilityState === "visible",
        onReloaded: (key, page) => {
          const slot = key as Slot;
          latestText.current[slot] = page.text;
          setSlot(slot, { text: page.text });
          notifyRef.current(`“${page.name}” changed on disk and was reloaded.`);
        },
      });
      try {
        const recovered = (await connectionRef.current?.recover(b.store, await liveTabs())) ?? [];
        const shown = recovered.filter((r) => r.kind !== "discarded");
        if (shown.length) {
          await refresh();
          notifyRef.current(
            `Recovered unsaved edits to ${shown
              .map((r) =>
                r.kind === "applied" ? `“${r.page}”` : `“${r.page}” (saved in the library as “${r.savedAs}”)`,
              )
              .join(", ")}.`,
            "warn",
          );
        }
      } catch (error) {
        notifyRef.current(`Couldn’t recover drafts for “${folder.name}”: ${errorMessage(error)}`, "warn");
      }
      await rescan();
      for (const slot of SLOTS) {
        const pending = pendingFiles.current[slot];
        if (!pending) continue;
        const current = sessions.current[slot]?.ref ?? null;
        if (!shouldReopen(slot, pending, current)) {
          // B isn't showing yet (Single view): Compare opens the file later.
          if (slot === "b" && !pending.fallback) continue;
          pendingFiles.current[slot] = null;
          continue;
        }
        pendingFiles.current[slot] = null;
        try {
          await openInSlot(slot, pending.ref);
        } catch (error) {
          if (!isStoreError(error, "not-found")) notifyRef.current(errorMessage(error), "warn");
        }
      }
      rewatch();
    },
    [openInSlot, refresh, rescan, rewatch, setSlot],
  );

  // Boot: open the store, recover, migrate, open the last pages, reconnect the folder.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const b = await boot();
        if (cancelled) return;
        bootRef.current = b;
        setStorage({ kind: b.store.kind, durable: b.store.durable, persistent: b.persistent });
        const list = await refresh();
        const names = new Set(list.map((p) => p.name as string));
        const fallback = list.find((p) => p.name === "Welcome")?.name ?? list[0]?.name ?? null;
        const savedA = decodeRef(readKey(KEYS.openA));
        const savedB = decodeRef(readKey(KEYS.openB));
        if (savedA?.kind === "file") {
          pendingFiles.current.a = { ref: savedA, fallback: fallback ? libraryRef(fallback) : null };
          await openInSlot("a", fallback, { remember: false });
        } else {
          await openInSlot("a", savedA && names.has(savedA.name) ? savedA.name : fallback);
        }
        if (savedB?.kind === "file") pendingFiles.current.b = { ref: savedB, fallback: null };
        setReady(true);
        const recovered = b.recoveries.filter((r) => r.kind !== "discarded");
        if (recovered.length) {
          const parts = recovered.map((r) =>
            r.kind === "applied" ? `“${r.page}”` : `“${r.page}” (saved as “${r.savedAs}”)`,
          );
          notifyRef.current(`Recovered unsaved edits from a closed tab: ${parts.join(", ")}.`, "warn");
        }
        if (b.migrated.length) notifyRef.current(`Imported ${b.migrated.length} page(s) from the previous version.`);
        if (b.movedFromFallback) notifyRef.current(`Moved ${b.movedFromFallback} page(s) into the file system store.`);
        if (!b.store.durable) notifyRef.current("This browser can’t store pages. Work will be lost on reload.", "warn");

        const connection = new FolderConnection({
          kv: b.kv,
          handles: new IdbHandleStore(),
          tabId: b.tabId,
          supported: folderPickerSupported(),
        });
        connectionRef.current = connection;
        connection.subscribe(setFolderState);
        setFolderState(connection.state);
        const state = await connection.restore();
        if (!cancelled && state.status === "connected") await onConnected(state.folder);
      } catch (error) {
        if (!cancelled) setFailure(errorMessage(error));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [onConnected, openInSlot, refresh]);

  // Cross-tab refresh.
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const ch = new BroadcastChannel(CHANNEL);
    channel.current = ch;
    ch.onmessage = async (event: MessageEvent) => {
      const b = bootRef.current;
      if (!b) return;
      const name = typeof event.data === "string" ? event.data : "";
      await refresh();
      if (!name) return;
      for (const slot of SLOTS) {
        const open = sessions.current[slot];
        if (!open || open.ref.kind !== "library" || open.ref.name !== name) continue;
        try {
          const page = await b.store.read(open.ref.name);
          if ((open.session as PageSession<PageName>).adoptRemote(page)) {
            latestText.current[slot] = page.text;
            setSlot(slot, { text: page.text });
          }
        } catch {
          // Deleted elsewhere: the session recreates it on the next save.
        }
      }
    };
    return () => {
      ch.close();
      channel.current = null;
    };
  }, [refresh, setSlot]);

  /** Save every open page now. Resolves true only if every one is saved. */
  const flushAll = useCallback(async (): Promise<boolean> => {
    await Promise.all(SLOTS.map((slot) => sessions.current[slot]?.session.flush()));
    return SLOTS.every((slot) => {
      const open = sessions.current[slot];
      return !open || open.session.stopped || open.session.status === "saved";
    });
  }, []);

  // Save when the tab is hidden or closed (the journal covers what can't finish);
  // list the folder again when the tab comes back.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") void flushAll();
      else if (connected()) {
        // Back from an editor or a terminal: check the open files now, then the list.
        void watcherRef.current?.tick();
        void rescan();
      }
    };
    const onPageHide = () => void flushAll();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [connected, flushAll, rescan]);

  useEffect(() => () => watcherRef.current?.stop(), []);

  const edit = useCallback(
    (slot: Slot, text: string) => {
      const open = sessions.current[slot];
      if (!open) return;
      latestText.current[slot] = text;
      open.session.update(text);
      setSlot(slot, { text, status: open.session.status });
      if (!askedPersist.current && typeof navigator !== "undefined" && navigator.storage?.persist) {
        askedPersist.current = true;
        navigator.storage
          .persist()
          .then((persistent) => setStorage((info) => (info ? { ...info, persistent } : info)))
          .catch(() => {});
      }
    },
    [setSlot],
  );

  const createPage = useCallback(
    async (desired: string, text: string, slot: Slot = "a"): Promise<PageName | null> => {
      const b = bootRef.current;
      if (!b) return null;
      const name = await availableName(b.store, desired);
      await b.store.create(name, text);
      await refresh();
      broadcast("");
      await openInSlot(slot, name);
      return name;
    },
    [broadcast, openInSlot, refresh],
  );

  const slotOf = useCallback(
    (ref: PageRef): Slot | undefined => SLOTS.find((s) => sameRef(sessions.current[s]?.ref ?? null, ref)),
    [],
  );

  /** Rename a library page. Returns an error message, or null on success. */
  const renamePage = useCallback(
    async (from: PageName, input: string): Promise<string | null> => {
      const b = bootRef.current;
      if (!b) return "Storage is not ready.";
      try {
        const to = parsePageName(input);
        if (to === from) return null;
        const slot = slotOf(libraryRef(from));
        if (slot) {
          const open = sessions.current[slot]!;
          const result = await (open.session as PageSession<PageName>).rename(to);
          open.ref = libraryRef(result.name);
          setSlot(slot, refPatch(open.ref));
          remember(slot, open.ref);
        } else {
          await b.store.rename(from, to);
        }
        await refresh();
        broadcast("");
        return null;
      } catch (error) {
        return errorMessage(error);
      }
    },
    [broadcast, refresh, remember, setSlot, slotOf],
  );

  /** Copy a page or file into a new library page. */
  const duplicatePage = useCallback(
    async (target: PageRef | PageName, slot?: Slot): Promise<PageName | null> => {
      const b = bootRef.current;
      if (!b) return null;
      const ref = typeof target === "string" ? libraryRef(target) : target;
      const open = slotOf(ref);
      if (open) await sessions.current[open]!.session.flush();
      let text: string;
      if (ref.kind === "library") {
        text = (await b.store.read(ref.name)).text;
      } else {
        const folder = connected();
        if (!folder) return null;
        text = (await folder.sheet.read(ref.path)).text;
      }
      const copy = await availableName(b.store, copyNameFor(ref, " copy"));
      await b.store.create(copy, text);
      await refresh();
      broadcast("");
      if (slot) await openInSlot(slot, copy);
      return copy;
    },
    [broadcast, connected, openInSlot, refresh, slotOf],
  );

  const trashPage = useCallback(
    async (name: PageName) => {
      const b = bootRef.current;
      if (!b) return;
      const ref = libraryRef(name);
      const openSlots = SLOTS.filter((s) => sameRef(sessions.current[s]?.ref ?? null, ref));
      for (const slot of openSlots) {
        await sessions.current[slot]!.session.dispose();
        sessions.current[slot] = null;
      }
      await b.store.trash(name);
      const list = await refresh();
      broadcast("");
      notifyRef.current(`Moved “${name}” to the trash.`);
      for (const slot of openSlots) {
        const other = sessions.current[slot === "a" ? "b" : "a"]?.ref;
        const next = list.find((p) => !(other?.kind === "library" && other.name === p.name))?.name ?? null;
        if (next) await openInSlot(slot, next);
        else if (slot === "a") await createPage("Untitled", "", "a");
        else setSlot("b", EMPTY_SLOT);
      }
    },
    [broadcast, createPage, openInSlot, refresh, setSlot],
  );

  const restorePage = useCallback(
    async (id: TrashId) => {
      const b = bootRef.current;
      if (!b) return;
      const result = await b.store.restore(id);
      await refresh();
      broadcast("");
      notifyRef.current(`Restored “${result.name}”.`);
    },
    [broadcast, refresh],
  );

  const purgePages = useCallback(
    async (ids: TrashId[]) => {
      const b = bootRef.current;
      if (!b) return;
      for (const id of ids) {
        try {
          await b.store.purge(id);
        } catch (error) {
          if (!isStoreError(error, "not-found")) throw error;
        }
      }
      await refresh();
      broadcast("");
    },
    [broadcast, refresh],
  );

  /** Open a page in slot B (compare): the remembered one, else another recent page. */
  const ensureSlotB = useCallback(async () => {
    if (sessions.current.b) return;
    const ticket = requests.current.begin("b");
    const list = await refresh();
    // Compare was left, or something else opened in B, while the list loaded.
    if (!ticket.current() || sessions.current.b) return;
    const a = sessions.current.a?.ref ?? null;
    const saved = decodeRef(readKey(KEYS.openB));
    const pending = pendingFiles.current.b;
    const wanted = saved ?? pending?.ref ?? null;
    if (wanted?.kind === "file" && connected() && !sameRef(wanted, a)) {
      try {
        pendingFiles.current.b = null;
        await openInSlot("b", wanted, { ticket });
        return;
      } catch {
        // The file is gone or unreadable: fall back to a library page.
      }
    }
    const notA = (p: PageSummary) => !(a?.kind === "library" && a.name === p.name);
    const pick =
      (wanted?.kind === "library" ? list.find((p) => p.name === wanted.name && notA(p))?.name : undefined) ??
      list.find(notA)?.name ??
      null;
    if (!ticket.current()) return;
    // A remembered file whose folder isn't connected yet: show a library page
    // meanwhile, without forgetting the file, and reopen it on connect.
    const waiting = wanted?.kind === "file" && !connected() && !sameRef(wanted, a);
    if (pick) {
      await openInSlot("b", pick, { ticket, remember: !waiting });
      if (waiting && ticket.current()) pendingFiles.current.b = { ref: wanted, fallback: libraryRef(pick) };
    } else {
      // Only one page exists: make an empty one for B, unless Compare was left meanwhile.
      const b = bootRef.current;
      if (!b) return;
      const name = await availableName(b.store, "Untitled");
      if (!ticket.current()) return;
      await b.store.create(name, "");
      await refresh();
      broadcast("");
      await openInSlot("b", name, { ticket });
    }
  }, [broadcast, connected, openInSlot, refresh]);

  const closeSlotB = useCallback(async () => {
    // Supersede any open still pending for B, even if nothing is open yet.
    const ticket = requests.current.begin("b");
    const open = sessions.current.b;
    if (!open) return;
    await open.session.dispose();
    // Compare may have been entered again while B saved: leave the new page alone.
    if (!ticket.current() || sessions.current.b !== open) return;
    sessions.current.b = null;
    watcherRef.current?.unwatch("b");
    setSlotB(EMPTY_SLOT);
  }, []);

  const swapSlots = useCallback(async () => {
    const a = sessions.current.a?.ref;
    const b = sessions.current.b?.ref;
    if (!a || !b) return;
    await openInSlot("a", b);
  }, [openInSlot]);

  /** Save pending edits, then zip every library page (not the trash, not folder files). */
  const exportAll = useCallback(async (): Promise<LibraryArchive | null> => {
    const b = bootRef.current;
    if (!b) return null;
    await flushAll();
    return buildLibraryArchive(b.store);
  }, [flushAll]);

  /** Import pages from a zip. Never changes existing pages. @throws ZipError */
  const importArchive = useCallback(
    async (bytes: Uint8Array): Promise<ImportReport | null> => {
      const b = bootRef.current;
      if (!b) return null;
      try {
        return await importZip(b.store, bytes);
      } finally {
        // Refresh even after a partial import so every created page is visible.
        await refresh();
        broadcast("");
      }
    },
    [broadcast, refresh],
  );

  // -------------------------------------------------------------------------
  // The folder

  /** Close open files (after saving), and forget the folder. */
  const disconnect = useCallback(async () => {
    const b = bootRef.current;
    const connection = connectionRef.current;
    if (!b || !connection) return;
    const fileSlots = SLOTS.filter((s) => sessions.current[s]?.ref.kind === "file");
    for (const slot of fileSlots) {
      await sessions.current[slot]!.session.dispose();
      sessions.current[slot] = null;
    }
    watcherRef.current?.stop();
    watcherRef.current = null;
    pendingFiles.current = { a: null, b: null };
    const copies = await connection.forget(b.store, await liveTabs());
    setFolderFiles([]);
    setFolderPartial(false);
    unreadable.current.clear();
    const list = await refresh();
    if (copies.length)
      notifyRef.current(`Saved leftover edits in the library: ${copies.map((c) => `“${c}”`).join(", ")}.`, "warn");
    for (const slot of fileSlots) {
      const other = sessions.current[slot === "a" ? "b" : "a"]?.ref;
      const next = list.find((p) => !(other?.kind === "library" && other.name === p.name))?.name ?? null;
      if (next) await openInSlot(slot, next);
      else if (slot === "a") await createPage("Untitled", "", "a");
      else setSlot("b", EMPTY_SLOT);
    }
  }, [createPage, openInSlot, refresh, setSlot]);

  /** Ask for a folder, and open it (replacing the open one). */
  const openFolder = useCallback(async () => {
    const connection = connectionRef.current;
    if (!connection) return;
    const picker = (
      window as unknown as {
        showDirectoryPicker?: (options?: {
          mode?: "read" | "readwrite";
          id?: string;
        }) => Promise<FileSystemDirectoryHandle>;
      }
    ).showDirectoryPicker;
    if (!picker) return;
    let handle: FileSystemDirectoryHandle;
    const asked = Date.now();
    try {
      handle = await picker({ mode: "readwrite", id: "a4-folder" });
    } catch (error) {
      if (errorName(error) === "AbortError") {
        // A cancel takes a person longer than this: the browser refused to show the picker.
        if (Date.now() - asked < 250) {
          notifyRef.current(
            "This browser didn’t show a folder picker. Open A4 in Chrome or Edge to edit a folder.",
            "warn",
          );
        }
        return;
      }
      notifyRef.current(`Couldn’t open that folder: ${errorMessage(error)} Try the repository folder itself.`, "warn");
      return;
    }
    if (connection.state.status !== "none" && connection.state.status !== "unsupported") await disconnect();
    try {
      const state = await connection.open(handle);
      if (state.status === "connected") await onConnected(state.folder);
    } catch (error) {
      notifyRef.current(`Couldn’t open that folder: ${errorMessage(error)}`, "warn");
    }
  }, [disconnect, onConnected]);

  const reconnectFolder = useCallback(async () => {
    const connection = connectionRef.current;
    if (!connection) return;
    try {
      const state = await connection.reconnect();
      if (state.status === "connected") await onConnected(state.folder);
      else if (state.status === "reconnect")
        notifyRef.current(`A4 still doesn’t have access to “${state.name}”.`, "warn");
    } catch (error) {
      notifyRef.current(`Couldn’t reconnect: ${errorMessage(error)}`, "warn");
    }
  }, [onConnected]);

  /**
   * Create a file in the folder and open it in `slot`. Never overwrites.
   * Returns an error message, or null on success.
   */
  const createFile = useCallback(
    async (input: string, text: string, slot: Slot): Promise<string | null> => {
      const folder = connected();
      if (!folder) return "Open a folder first.";
      let path: FilePath;
      try {
        path = parseFilePath(input.trim());
      } catch (error) {
        return errorMessage(error);
      }
      try {
        await folder.sheet.create(path, text);
      } catch (error) {
        if (isStoreError(error, "exists")) return `“${path}” already exists in “${folder.name}”.`;
        return errorMessage(error);
      }
      await rescan();
      await openInSlot(slot, fileRef(path));
      return null;
    },
    [connected, openInSlot, rescan],
  );

  /**
   * Write the library page `name` to a new file, and open the file in the slot
   * that shows the page (or in `slot`). The page is the one Save to folder was
   * chosen for, whatever the slot shows by the time the path is submitted.
   */
  const saveToFolder = useCallback(
    async (name: PageName, input: string, slot: Slot): Promise<string | null> => {
      const b = bootRef.current;
      if (!b) return "Storage is not ready.";
      const ref = libraryRef(name);
      const shownIn = slotOf(ref);
      if (shownIn) await sessions.current[shownIn]!.session.flush();
      let text: string;
      try {
        text = (await b.store.read(name)).text;
      } catch (error) {
        return isStoreError(error, "not-found") ? `“${name}” no longer exists.` : errorMessage(error);
      }
      const error = await createFile(input, text, shownIn ?? slot);
      if (!error) notifyRef.current(`Saved “${name}” to the folder as “${input.trim()}”.`);
      return error;
    },
    [createFile, slotOf],
  );

  const folder: FolderView = { state: folderState, files: folderFiles, partial: folderPartial, scanning };

  return {
    ready,
    failure,
    pages,
    trash,
    slotA,
    slotB,
    storage,
    folder,
    edit,
    openInSlot,
    createPage,
    renamePage,
    duplicatePage,
    trashPage,
    restorePage,
    purgePages,
    ensureSlotB,
    closeSlotB,
    swapSlots,
    flushAll,
    exportAll,
    importArchive,
    openFolder,
    reconnectFolder,
    closeFolder: disconnect,
    rescanFolder: rescan,
    createFile,
    saveToFolder,
  };
}
