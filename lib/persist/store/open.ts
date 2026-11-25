/**
 * Backend selection: OPFS when the browser supports writable OPFS files,
 * otherwise localStorage, otherwise memory. When OPFS is chosen, pages left in
 * the localStorage store (saved while OPFS was unavailable) are moved in.
 */

import type { Clock } from "../../platform/clock.ts";
import type { DeviceStorage } from "../../platform/device-storage.ts";
import { StorageKeyValue } from "../../platform/key-value.ts";
import type { Locks } from "../../platform/locks.ts";
import { KeyValuePageStore, MemoryPageStore } from "./key-value.ts";
import { OpfsPageStore } from "./opfs.ts";
import type { PageStore } from "./types.ts";

export interface OpenedStore {
  store: PageStore;
  /** Pages moved from the localStorage fallback into OPFS on this open. */
  movedFromFallback: number;
}

function localStorageStore(storage: Storage, options: { clock?: Clock; locks?: Locks | null } = {}): KeyValuePageStore {
  return new KeyValuePageStore(new StorageKeyValue(storage), {
    kind: "local-storage",
    durable: true,
    locks: options.locks ?? null,
    ...(options.clock ? { clock: options.clock } : {}),
  });
}

/** Copy every page from `from` into `to` (unique names), then purge it from `from`. */
export async function movePages(from: PageStore, to: PageStore): Promise<number> {
  const pages = await from.list();
  if (pages.length === 0) return 0;
  let moved = 0;
  for (const summary of pages) {
    const page = await from.read(summary.name);
    await to.createUnique(page.name, page.text);
    const entry = await from.trash(page.name);
    await from.purge(entry.id);
    moved++;
  }
  return moved;
}

export async function openPageStore(
  device: DeviceStorage,
  options: { locks: Locks | null; clock: Clock },
): Promise<OpenedStore> {
  const storage = device.localStorage();
  const root = device.opfsRoot();
  if (root) {
    try {
      const store = await OpfsPageStore.open(await root, options);
      const movedFromFallback = storage ? await movePages(localStorageStore(storage, options), store) : 0;
      return { store, movedFromFallback };
    } catch {
      // Fall through (e.g. Firefox private windows reject OPFS access).
    }
  }
  if (storage) return { store: localStorageStore(storage, options), movedFromFallback: 0 };
  return { store: new MemoryPageStore({ clock: options.clock }), movedFromFallback: 0 };
}
