/**
 * Remembered folders: each picked folder gets a stable id, and its handle is
 * kept in the HandleStore (IndexedDB in the browser) under that id. The
 * remembered folder's id is the scalar key `a4:folder`. A folder picked again
 * keeps its id (`FolderSource.same`), so tabs that opened it share locks and
 * drafts.
 */

import type { HandleStore } from "../platform/handle-store.ts";
import type { KeyValue } from "../platform/key-value.ts";
import type { RandomId } from "../platform/random-id.ts";
import type { FolderSource } from "./fs.ts";

export const FOLDER_KEY = "a4:folder";

export interface FolderRegistryOptions<H> {
  kv: KeyValue;
  handles: HandleStore<H>;
  source: FolderSource<H>;
  randomId: RandomId;
}

export class FolderRegistry<H> {
  readonly #kv: KeyValue;
  readonly #handles: HandleStore<H>;
  readonly #source: FolderSource<H>;
  readonly #randomId: RandomId;

  constructor(options: FolderRegistryOptions<H>) {
    this.#kv = options.kv;
    this.#handles = options.handles;
    this.#source = options.source;
    this.#randomId = options.randomId;
  }

  /** The remembered folder's id, or null. */
  rememberedId(): string | null {
    try {
      return this.#kv.get(FOLDER_KEY);
    } catch {
      return null;
    }
  }

  /** The remembered folder: its id, and its handle (null when the handle is gone). */
  async remembered(): Promise<{ id: string; handle: H | null } | null> {
    const id = this.rememberedId();
    if (!id) return null;
    try {
      return { id, handle: await this.#handles.get(id) };
    } catch {
      return { id, handle: null };
    }
  }

  /** Remember a folder the user just picked; returns its id (an existing one when it's known). */
  async remember(handle: H): Promise<string> {
    const id = (await this.#knownId(handle)) ?? this.#randomId();
    await this.#handles.set(id, handle);
    try {
      this.#kv.set(FOLDER_KEY, id);
    } catch {
      // Storage unavailable: the folder works until reload.
    }
    return id;
  }

  /** Forget a folder: its handle, and (when it's the remembered one) the remembered id. */
  async forget(id: string): Promise<void> {
    await this.#handles.delete(id).catch(() => {});
    try {
      if (this.rememberedId() === id) this.#kv.remove(FOLDER_KEY);
    } catch {
      // Storage unavailable.
    }
  }

  async #knownId(handle: H): Promise<string | null> {
    let known: [string, H][];
    try {
      known = await this.#handles.entries();
    } catch {
      return null;
    }
    for (const [id, stored] of known) {
      try {
        if (await this.#source.same(stored, handle)) return id;
      } catch {
        // A stored handle to a folder that is gone can't match.
      }
    }
    return null;
  }
}
