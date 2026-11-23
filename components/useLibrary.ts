"use client";

/**
 * useLibrary: the page library and the open pages (slots A and B).
 *
 * Owns the PageStore, one PageSession per open slot, startup recovery and
 * migration, cross-tab refresh (BroadcastChannel), and flush-on-hide. UI code
 * talks to pages only through the actions returned here.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ensureFirstPage,
  Journal,
  migrateLegacySlots,
  PageSession,
  recoverDrafts,
  type Recovery,
  type SaveStatus,
  type SessionEvent,
} from "@/lib/autosave";
import { buildLibraryArchive, type LibraryArchive } from "@/lib/export";
import { importZip, type ImportReport } from "@/lib/import";
import { INCIDENT_JSON, INCIDENT_NARRATIVE, TEMPLATES, WELCOME } from "@/lib/samples";
import { browserKeyValue, KEYS, readKey, writeKey } from "@/lib/storage";
import {
  availableName,
  isStoreError,
  openPageStore,
  parsePageName,
  type KeyValue,
  type PageName,
  type PageStore,
  type PageSummary,
  type StoreKind,
  type TrashEntry,
  type TrashId,
} from "@/lib/store";

export type Slot = "a" | "b";

export interface SlotState {
  name: PageName | null;
  text: string;
  status: SaveStatus;
}

export interface StorageInfo {
  kind: StoreKind;
  durable: boolean;
  persistent: boolean | null;
}

export type Notify = (message: string, tone?: "info" | "warn") => void;

const EMPTY_SLOT: SlotState = { name: null, text: "", status: "saved" };
const CHANNEL = "a4-pages";
const SKIP_MIGRATION = [WELCOME, INCIDENT_JSON, INCIDENT_NARRATIVE, ...TEMPLATES.map((t) => t.text)];

interface Boot {
  store: PageStore;
  journal: Journal;
  kv: KeyValue;
  recoveries: Recovery[];
  migrated: PageName[];
  movedFromFallback: number;
  persistent: boolean | null;
}

/** Hold a Web Lock for this tab's lifetime; return the ids of all live tabs. */
async function holdTabLock(tabId: string): Promise<Set<string> | null> {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (!locks) return null;
  void locks.request(`a4:tab:${tabId}`, () => new Promise<void>(() => {}));
  try {
    const snapshot = await locks.query();
    const names = [...(snapshot.held ?? []), ...(snapshot.pending ?? [])].map((l) => l.name ?? "");
    return new Set(names.filter((n) => n.startsWith("a4:tab:")).map((n) => n.slice("a4:tab:".length)));
  } catch {
    return null;
  }
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
    return { store, journal, kv, recoveries, migrated, movedFromFallback, persistent };
  })();
  return bootPromise;
}

function byRecent(pages: PageSummary[]): PageSummary[] {
  return [...pages].sort((a, b) => b.modifiedAt - a.modifiedAt || a.name.localeCompare(b.name));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useLibrary(notify: Notify) {
  const [ready, setReady] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [pages, setPages] = useState<PageSummary[]>([]);
  const [trash, setTrash] = useState<TrashEntry[]>([]);
  const [slotA, setSlotA] = useState<SlotState>(EMPTY_SLOT);
  const [slotB, setSlotB] = useState<SlotState>(EMPTY_SLOT);
  const [storage, setStorage] = useState<StorageInfo | null>(null);

  const bootRef = useRef<Boot | null>(null);
  const sessions = useRef<Record<Slot, PageSession | null>>({ a: null, b: null });
  const channel = useRef<BroadcastChannel | null>(null);
  const askedPersist = useRef(false);
  const notifyRef = useRef(notify);
  notifyRef.current = notify;

  const setSlot = useCallback((slot: Slot, patch: Partial<SlotState>) => {
    (slot === "a" ? setSlotA : setSlotB)((s) => ({ ...s, ...patch }));
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

  const remember = useCallback((slot: Slot, name: PageName | null) => {
    writeKey(slot === "a" ? KEYS.openA : KEYS.openB, name ?? "");
  }, []);

  const onSessionEvent = useCallback(
    (slot: Slot, event: SessionEvent) => {
      switch (event.type) {
        case "status":
          setSlot(slot, { status: event.status });
          break;
        case "saved":
          setPages((list) =>
            byRecent(
              list.map((p) =>
                p.name === event.result.name ? { ...p, size: event.result.size, modifiedAt: event.result.modifiedAt } : p,
              ),
            ),
          );
          broadcast(event.result.name);
          break;
        case "conflict":
          setSlot(slot, { name: event.copy });
          remember(slot, event.copy);
          notifyRef.current(
            `“${event.original}” was changed in another tab. Your version was saved as “${event.copy}”.`,
            "warn",
          );
          void refresh();
          broadcast("");
          break;
        case "recreated":
          setSlot(slot, { name: event.name });
          remember(slot, event.name);
          notifyRef.current(`“${event.original}” was deleted elsewhere, so your edits were saved as “${event.name}”.`, "warn");
          void refresh();
          broadcast("");
          break;
        case "error":
          break;
      }
    },
    [broadcast, refresh, remember, setSlot],
  );

  /** Open `name` in `slot`, saving whatever was open there first. */
  const openInSlot = useCallback(
    async (slot: Slot, name: PageName | null): Promise<void> => {
      const b = bootRef.current;
      if (!b) return;
      const other: Slot = slot === "a" ? "b" : "a";
      const current = sessions.current[slot];
      if (name && current?.name === name) return;
      if (name && sessions.current[other]?.name === name) {
        // A page can be open in one slot only: exchange the two slots.
        sessions.current[slot] = sessions.current[other];
        sessions.current[other] = current;
        for (const s of ["a", "b"] as const) {
          const session = sessions.current[s];
          setSlot(s, session ? { name: session.name, text: session.text, status: session.status } : EMPTY_SLOT);
          remember(s, session?.name ?? null);
        }
        return;
      }
      if (current) await current.dispose();
      sessions.current[slot] = null;
      if (!name) {
        setSlot(slot, EMPTY_SLOT);
        remember(slot, null);
        return;
      }
      const page = await b.store.read(name);
      // Events go to whichever slot holds the session now, so swaps need no rebinding.
      const session: PageSession = new PageSession({
        store: b.store,
        journal: b.journal,
        page,
        onEvent: (e) => {
          const at = (["a", "b"] as const).find((s) => sessions.current[s] === session);
          if (at) onSessionEvent(at, e);
        },
      });
      sessions.current[slot] = session;
      setSlot(slot, { name: page.name, text: page.text, status: "saved" });
      remember(slot, page.name);
    },
    [onSessionEvent, remember, setSlot],
  );

  // Boot: open the store, recover, migrate, open the last pages.
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
        const savedA = readKey(KEYS.openA);
        const first =
          savedA && names.has(savedA) ? (savedA as PageName) : (list.find((p) => p.name === "Welcome")?.name ?? list[0]?.name ?? null);
        await openInSlot("a", first);
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
      } catch (error) {
        if (!cancelled) setFailure(errorMessage(error));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [openInSlot, refresh]);

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
      for (const slot of ["a", "b"] as const) {
        const s = sessions.current[slot];
        if (!s || s.name !== name) continue;
        try {
          const page = await b.store.read(s.name);
          if (s.adoptRemote(page)) setSlot(slot, { text: page.text });
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

  const flushAll = useCallback(async () => {
    await Promise.all((["a", "b"] as const).map((slot) => sessions.current[slot]?.flush()));
  }, []);

  // Save when the tab is hidden or closed (the journal covers what can't finish).
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") void flushAll();
    };
    const onPageHide = () => void flushAll();
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [flushAll]);

  const edit = useCallback(
    (slot: Slot, text: string) => {
      const s = sessions.current[slot];
      if (!s) return;
      s.update(text);
      setSlot(slot, { text, status: s.status });
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

  /** Rename a page. Returns an error message, or null on success. */
  const renamePage = useCallback(
    async (from: PageName, input: string): Promise<string | null> => {
      const b = bootRef.current;
      if (!b) return "Storage is not ready.";
      try {
        const to = parsePageName(input);
        if (to === from) return null;
        const slot = (["a", "b"] as const).find((s) => sessions.current[s]?.name === from);
        if (slot) {
          const result = await sessions.current[slot]!.rename(to);
          setSlot(slot, { name: result.name });
          remember(slot, result.name);
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
    [broadcast, refresh, remember, setSlot],
  );

  const duplicatePage = useCallback(
    async (name: PageName, slot?: Slot): Promise<PageName | null> => {
      const b = bootRef.current;
      if (!b) return null;
      const open = (["a", "b"] as const).find((s) => sessions.current[s]?.name === name);
      if (open) await sessions.current[open]!.flush();
      const page = await b.store.read(name);
      const copy = await availableName(b.store, `${name} copy`);
      await b.store.create(copy, page.text);
      await refresh();
      broadcast("");
      if (slot) await openInSlot(slot, copy);
      return copy;
    },
    [broadcast, openInSlot, refresh],
  );

  const trashPage = useCallback(
    async (name: PageName) => {
      const b = bootRef.current;
      if (!b) return;
      const openSlots = (["a", "b"] as const).filter((s) => sessions.current[s]?.name === name);
      for (const slot of openSlots) {
        await sessions.current[slot]!.dispose();
        sessions.current[slot] = null;
      }
      await b.store.trash(name);
      const list = await refresh();
      broadcast("");
      notifyRef.current(`Moved “${name}” to the trash.`);
      for (const slot of openSlots) {
        const other = sessions.current[slot === "a" ? "b" : "a"]?.name;
        const next = list.find((p) => p.name !== other)?.name ?? null;
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
    const list = await refresh();
    const a = sessions.current.a?.name;
    const saved = readKey(KEYS.openB);
    const pick =
      list.find((p) => p.name === saved && p.name !== a)?.name ?? list.find((p) => p.name !== a)?.name ?? null;
    if (pick) await openInSlot("b", pick);
    else await createPage("Untitled", "", "b");
  }, [createPage, openInSlot, refresh]);

  const closeSlotB = useCallback(async () => {
    const s = sessions.current.b;
    if (!s) return;
    await s.dispose();
    sessions.current.b = null;
    setSlotB(EMPTY_SLOT);
  }, []);

  const swapSlots = useCallback(async () => {
    const a = sessions.current.a?.name;
    const b = sessions.current.b?.name;
    if (!a || !b) return;
    await openInSlot("a", b);
  }, [openInSlot]);

  /** Save pending edits, then zip every page (not the trash). */
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

  return {
    ready,
    failure,
    pages,
    trash,
    slotA,
    slotB,
    storage,
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
  };
}
