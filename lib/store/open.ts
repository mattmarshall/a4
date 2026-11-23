/**
 * Backend selection: OPFS when the browser supports writable OPFS files,
 * otherwise localStorage, otherwise memory. When OPFS is chosen, pages left in
 * the localStorage store (saved while OPFS was unavailable) are moved in.
 */

import { KeyValuePageStore, MemoryPageStore, StorageKeyValue } from "./key-value.ts";
import { nextAvailableName } from "./names.ts";
import { OpfsPageStore, opfsSupported } from "./opfs.ts";
import type { PageStore } from "./types.ts";

export interface OpenedStore {
  store: PageStore;
  /** Pages moved from the localStorage fallback into OPFS on this open. */
  movedFromFallback: number;
}

export function localStorageStore(storage: Storage): KeyValuePageStore {
  return new KeyValuePageStore(new StorageKeyValue(storage), { kind: "local-storage", durable: true });
}

function usableLocalStorage(): Storage | null {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return null;
    const probe = "a4:probe";
    storage.setItem(probe, "1");
    storage.removeItem(probe);
    return storage;
  } catch {
    return null;
  }
}

/** Copy every page from `from` into `to` (unique names), then purge it from `from`. */
export async function movePages(from: PageStore, to: PageStore): Promise<number> {
  const pages = await from.list();
  if (pages.length === 0) return 0;
  const taken = (await to.list()).map((p) => p.name as string);
  let moved = 0;
  for (const summary of pages) {
    const page = await from.read(summary.name);
    const name = nextAvailableName(page.name, taken);
    await to.create(name, page.text);
    taken.push(name);
    const entry = await from.trash(page.name);
    await from.purge(entry.id);
    moved++;
  }
  return moved;
}

export async function openPageStore(): Promise<OpenedStore> {
  const storage = usableLocalStorage();
  if (opfsSupported()) {
    try {
      const store = await OpfsPageStore.open();
      const movedFromFallback = storage ? await movePages(localStorageStore(storage), store) : 0;
      return { store, movedFromFallback };
    } catch {
      // Fall through (e.g. Firefox private windows reject OPFS access).
    }
  }
  if (storage) return { store: localStorageStore(storage), movedFromFallback: 0 };
  return { store: new MemoryPageStore(), movedFromFallback: 0 };
}
