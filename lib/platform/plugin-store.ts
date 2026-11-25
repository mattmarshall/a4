/**
 * Where installed plugins are kept in this browser: each plugin's record (an
 * `a4.v1.InstalledPlugin`, kept as bytes) by its id, and each downloaded model
 * file by its `urn:sha256:` digest. The browser adapter is IndexedDB, the only
 * store large enough everywhere A4 runs (database `a4-plugins`, object stores
 * `plugins` and `files`). The platform keeps bytes and never reads them; the
 * models layer checks them every time it uses them.
 */

/** Where installed plugins and their model files are kept. */
export interface PluginStore {
  /** Every stored record, by plugin id. */
  records(): Promise<[string, Uint8Array][]>;
  getRecord(id: string): Promise<Uint8Array | null>;
  putRecord(id: string, record: Uint8Array): Promise<void>;
  deleteRecord(id: string): Promise<void>;
  getFile(digest: string): Promise<Uint8Array | null>;
  putFile(digest: string, data: Uint8Array): Promise<void>;
  deleteFile(digest: string): Promise<void>;
}

export class MemoryPluginStore implements PluginStore {
  readonly plugins = new Map<string, Uint8Array>();
  readonly files = new Map<string, Uint8Array>();
  async records(): Promise<[string, Uint8Array][]> {
    return [...this.plugins.entries()].map(([id, r]) => [id, r.slice()]);
  }
  async getRecord(id: string) {
    return this.plugins.get(id)?.slice() ?? null;
  }
  async putRecord(id: string, record: Uint8Array) {
    this.plugins.set(id, record.slice());
  }
  async deleteRecord(id: string) {
    this.plugins.delete(id);
  }
  async getFile(digest: string) {
    return this.files.get(digest)?.slice() ?? null;
  }
  async putFile(digest: string, data: Uint8Array) {
    this.files.set(digest, data.slice());
  }
  async deleteFile(digest: string) {
    this.files.delete(digest);
  }
}

type StoreName = "plugins" | "files";

/** IndexedDB database `a4-plugins`: `plugins` (id → record bytes) and `files` (digest → file bytes). */
export class IdbPluginStore implements PluginStore {
  readonly #name: string;
  #db: Promise<IDBDatabase> | null = null;

  /** `name` is for tests; the app uses `a4-plugins`. */
  constructor(name = "a4-plugins") {
    this.#name = name;
  }

  #open(): Promise<IDBDatabase> {
    this.#db ??= new Promise((resolve, reject) => {
      const request = indexedDB.open(this.#name, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        for (const store of ["plugins", "files"]) {
          if (!db.objectStoreNames.contains(store)) db.createObjectStore(store);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return this.#db;
  }

  async #run<T>(name: StoreName, mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.#open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(name, mode);
      const request = fn(tx.objectStore(name));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  async #get(name: StoreName, key: string): Promise<Uint8Array | null> {
    const value = (await this.#run(name, "readonly", (s) => s.get(key))) as Uint8Array | undefined;
    return value ? new Uint8Array(value) : null;
  }

  async records(): Promise<[string, Uint8Array][]> {
    const db = await this.#open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("plugins", "readonly");
      const store = tx.objectStore("plugins");
      const keys = store.getAllKeys();
      const values = store.getAll();
      tx.oncomplete = () => resolve(keys.result.map((k, i) => [String(k), new Uint8Array(values.result[i])]));
      tx.onerror = () => reject(tx.error);
    });
  }
  getRecord(id: string) {
    return this.#get("plugins", id);
  }
  async putRecord(id: string, record: Uint8Array) {
    await this.#run("plugins", "readwrite", (s) => s.put(record.slice(), id));
  }
  async deleteRecord(id: string) {
    await this.#run("plugins", "readwrite", (s) => s.delete(id));
  }
  getFile(digest: string) {
    return this.#get("files", digest);
  }
  async putFile(digest: string, data: Uint8Array) {
    await this.#run("files", "readwrite", (s) => s.put(data.slice(), digest));
  }
  async deleteFile(digest: string) {
    await this.#run("files", "readwrite", (s) => s.delete(digest));
  }
}
