/**
 * Where picked folder handles are kept. A FileSystemDirectoryHandle can only
 * be persisted as a structured clone, so the browser adapter is IndexedDB
 * (database `a4`, object store `folders`: folder id → handle).
 */

/** Where picked folder handles are kept. */
export interface HandleStore<H = FileSystemDirectoryHandle> {
  get(id: string): Promise<H | null>;
  set(id: string, handle: H): Promise<void>;
  delete(id: string): Promise<void>;
  /** Every stored folder, so a re-picked folder can keep its id. */
  entries(): Promise<[string, H][]>;
}

export class MemoryHandleStore<H = FileSystemDirectoryHandle> implements HandleStore<H> {
  readonly map = new Map<string, H>();
  async get(id: string) {
    return this.map.get(id) ?? null;
  }
  async set(id: string, handle: H) {
    this.map.set(id, handle);
  }
  async delete(id: string) {
    this.map.delete(id);
  }
  async entries(): Promise<[string, H][]> {
    return [...this.map.entries()];
  }
}

/** IndexedDB database `a4`, object store `folders`: id → directory handle. */
export class IdbHandleStore implements HandleStore {
  #db: Promise<IDBDatabase> | null = null;

  #open(): Promise<IDBDatabase> {
    this.#db ??= new Promise((resolve, reject) => {
      const request = indexedDB.open("a4", 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains("folders")) request.result.createObjectStore("folders");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return this.#db;
  }

  async #run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.#open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("folders", mode);
      const request = fn(tx.objectStore("folders"));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  async get(id: string): Promise<FileSystemDirectoryHandle | null> {
    return ((await this.#run("readonly", (s) => s.get(id))) as FileSystemDirectoryHandle | undefined) ?? null;
  }
  async set(id: string, handle: FileSystemDirectoryHandle): Promise<void> {
    await this.#run("readwrite", (s) => s.put(handle, id));
  }
  async delete(id: string): Promise<void> {
    await this.#run("readwrite", (s) => s.delete(id));
  }
  async entries(): Promise<[string, FileSystemDirectoryHandle][]> {
    const db = await this.#open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("folders", "readonly");
      const store = tx.objectStore("folders");
      const keys = store.getAllKeys();
      const values = store.getAll();
      tx.oncomplete = () =>
        resolve(keys.result.map((k, i) => [String(k), values.result[i] as FileSystemDirectoryHandle]));
      tx.onerror = () => reject(tx.error);
    });
  }
}
