/**
 * Synchronous string storage: localStorage in the browser, a Map in tests
 * or when localStorage is unusable (private windows, disabled site data,
 * server rendering).
 */

export interface KeyValue {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
  keys(): string[];
}

export class MemoryKeyValue implements KeyValue {
  readonly #map = new Map<string, string>();
  get(key: string): string | null {
    return this.#map.get(key) ?? null;
  }
  set(key: string, value: string): void {
    this.#map.set(key, value);
  }
  remove(key: string): void {
    this.#map.delete(key);
  }
  keys(): string[] {
    return [...this.#map.keys()];
  }
}

/** Adapter over the Web Storage API. */
export class StorageKeyValue implements KeyValue {
  readonly #storage: Storage;
  constructor(storage: Storage) {
    this.#storage = storage;
  }
  get(key: string): string | null {
    return this.#storage.getItem(key);
  }
  set(key: string, value: string): void {
    this.#storage.setItem(key, value);
  }
  remove(key: string): void {
    this.#storage.removeItem(key);
  }
  keys(): string[] {
    const out: string[] = [];
    for (let i = 0; i < this.#storage.length; i++) {
      const k = this.#storage.key(i);
      if (k !== null) out.push(k);
    }
    return out;
  }
}

/** localStorage when writing to it works, else null. */
export function usableLocalStorage(): Storage | null {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return null;
    storage.setItem("a4:probe", "1");
    storage.removeItem("a4:probe");
    return storage;
  } catch {
    return null;
  }
}

/** localStorage as a KeyValue, or an in-memory stand-in when it is unusable. */
export function browserKeyValue(): KeyValue {
  const storage = usableLocalStorage();
  return storage ? new StorageKeyValue(storage) : new MemoryKeyValue();
}
