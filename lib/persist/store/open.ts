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
import { nextAvailableName } from "./names.ts";
import { OpfsPageStore } from "./opfs.ts";
import type { PageStore } from "./types.ts";

export interface OpenedStore {
  store: PageStore;
  /** Pages moved from the localStorage fallback into OPFS on this open. */
  movedFromFallback: number;
}

export function localStorageStore(storage: Storage, clock?: Clock): KeyValuePageStore {
  return new KeyValuePageStore(new StorageKeyValue(storage), {
    kind: "local-storage",
    durable: true,
    ...(clock ? { clock } : {}),
  });
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

export async function openPageStore(
  device: DeviceStorage,
  options: { locks: Locks | null; clock: Clock },
): Promise<OpenedStore> {
  const storage = device.localStorage();
  const root = device.opfsRoot();
  if (root) {
    try {
      const store = await OpfsPageStore.open(await root, options);
      const movedFromFallback = storage ? await movePages(localStorageStore(storage, options.clock), store) : 0;
      return { store, movedFromFallback };
    } catch {
      // Fall through (e.g. Firefox private windows reject OPFS access).
    }
  }
  if (storage) return { store: localStorageStore(storage, options.clock), movedFromFallback: 0 };
  return { store: new MemoryPageStore({ clock: options.clock }), movedFromFallback: 0 };
}
