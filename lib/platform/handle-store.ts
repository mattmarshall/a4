/**
 * Where picked folder handles are kept. A FileSystemDirectoryHandle can only
 * be persisted as a structured clone, so the browser adapter is IndexedDB
 * (database `a4`, object store `folders`: folder id → handle).
 */

import { IdbDatabase } from "./idb.ts";

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
  readonly #db: IdbDatabase;

  /** `name` is for tests; the app uses `a4`. */
  constructor(name = "a4") {
    this.#db = new IdbDatabase(name, 1, ["folders"]);
  }

  /** Close the database connection (a test's database can't be deleted while it's open). */
  close(): void {
    this.#db.close();
  }

  async get(id: string): Promise<FileSystemDirectoryHandle | null> {
    return (
      ((await this.#db.run("folders", "readonly", (s) => s.get(id))) as FileSystemDirectoryHandle | undefined) ?? null
    );
  }
  async set(id: string, handle: FileSystemDirectoryHandle): Promise<void> {
    await this.#db.run("folders", "readwrite", (s) => s.put(handle, id));
  }
  async delete(id: string): Promise<void> {
    await this.#db.run("folders", "readwrite", (s) => s.delete(id));
  }
  entries(): Promise<[string, FileSystemDirectoryHandle][]> {
    return this.#db.entries<FileSystemDirectoryHandle>("folders");
  }
}
