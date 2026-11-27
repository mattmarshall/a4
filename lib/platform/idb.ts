/**
 * A small IndexedDB wrapper for the platform's stores: a database with fixed
 * object stores, opened on first use, where each call is one request in its
 * own transaction. The plugin store and the folder-handle store use it.
 */

/** An IndexedDB database with fixed object stores, opened on first use. */
export class IdbDatabase {
  readonly #name: string;
  readonly #version: number;
  readonly #stores: readonly string[];
  #db: Promise<IDBDatabase> | null = null;

  constructor(name: string, version: number, stores: readonly string[]) {
    this.#name = name;
    this.#version = version;
    this.#stores = stores;
  }

  #open(): Promise<IDBDatabase> {
    this.#db ??= new Promise((resolve, reject) => {
      const request = indexedDB.open(this.#name, this.#version);
      request.onupgradeneeded = () => {
        const db = request.result;
        for (const store of this.#stores) {
          if (!db.objectStoreNames.contains(store)) db.createObjectStore(store);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return this.#db;
  }

  /** Run one request in its own transaction; resolves with its result once the transaction completes. */
  async run<T>(store: string, mode: IDBTransactionMode, request: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.#open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const pending = request(tx.objectStore(store));
      tx.oncomplete = () => resolve(pending.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  /** Every key and value in `store`, in one read transaction. Keys are read as strings. */
  async entries<V>(store: string): Promise<[string, V][]> {
    const db = await this.#open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, "readonly");
      const objects = tx.objectStore(store);
      const keys = objects.getAllKeys();
      const values = objects.getAll();
      tx.oncomplete = () => resolve(keys.result.map((key, i) => [String(key), values.result[i] as V]));
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }
}
