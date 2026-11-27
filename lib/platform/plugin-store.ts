/**
 * Where installed plugins are kept in this browser: each plugin's record (an
 * `a4.v1.InstalledPlugin`, kept as bytes) by its id, and each downloaded model
 * file by its `urn:sha256:` digest. The browser adapter is IndexedDB, the only
 * store large enough everywhere A4 runs (database `a4-plugins`, object stores
 * `plugins` and `files`). The platform keeps bytes and never reads them; the
 * models layer checks them every time it uses them.
 */

import { IdbDatabase } from "./idb.ts";

/**
 * The BroadcastChannel a tab posts an `a4.v1.PluginEvent` on after it
 * installs, updates, or removes a plugin, so other tabs read that record
 * again. It's named here, beside the store whose changes it announces, so a
 * tab can listen without loading the registry.
 */
export const PLUGIN_CHANNEL = "a4-plugins";

/** Where installed plugins and their model files are kept. */
export interface PluginStore {
  /** Every stored record, by plugin id. */
  records(): Promise<[string, Uint8Array][]>;
  getRecord(id: string): Promise<Uint8Array | null>;
  putRecord(id: string, record: Uint8Array): Promise<void>;
  deleteRecord(id: string): Promise<void>;
  getFile(digest: string): Promise<Uint8Array | null>;
  /** Whether a file is stored under `digest`, without reading its bytes. */
  hasFile(digest: string): Promise<boolean>;
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
  async hasFile(digest: string) {
    return this.files.has(digest);
  }
  async putFile(digest: string, data: Uint8Array) {
    this.files.set(digest, data.slice());
  }
  async deleteFile(digest: string) {
    this.files.delete(digest);
  }
}

/** IndexedDB database `a4-plugins`: `plugins` (id → record bytes) and `files` (digest → file bytes). */
export class IdbPluginStore implements PluginStore {
  readonly #db: IdbDatabase;

  /** `name` is for tests; the app uses `a4-plugins`. */
  constructor(name = "a4-plugins") {
    this.#db = new IdbDatabase(name, 1, ["plugins", "files"]);
  }

  /** Close the database connection (a test's database can't be deleted while it's open). */
  close(): void {
    this.#db.close();
  }

  async #get(store: "plugins" | "files", key: string): Promise<Uint8Array | null> {
    const value = (await this.#db.run(store, "readonly", (s) => s.get(key))) as Uint8Array | undefined;
    return value ? new Uint8Array(value) : null;
  }

  async records(): Promise<[string, Uint8Array][]> {
    return (await this.#db.entries<Uint8Array>("plugins")).map(([id, record]) => [id, new Uint8Array(record)]);
  }
  getRecord(id: string) {
    return this.#get("plugins", id);
  }
  async putRecord(id: string, record: Uint8Array) {
    await this.#db.run("plugins", "readwrite", (s) => s.put(record.slice(), id));
  }
  async deleteRecord(id: string) {
    await this.#db.run("plugins", "readwrite", (s) => s.delete(id));
  }
  getFile(digest: string) {
    return this.#get("files", digest);
  }
  async hasFile(digest: string) {
    return (await this.#db.run("files", "readonly", (s) => s.count(digest))) > 0;
  }
  async putFile(digest: string, data: Uint8Array) {
    await this.#db.run("files", "readwrite", (s) => s.put(data.slice(), digest));
  }
  async deleteFile(digest: string) {
    await this.#db.run("files", "readwrite", (s) => s.delete(digest));
  }
}
