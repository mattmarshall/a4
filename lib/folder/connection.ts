/**
 * The open folder: remembering it, connecting, reconnecting after a reload,
 * and forgetting it.
 *
 * The picked `FileSystemDirectoryHandle` can only be persisted as a
 * structured clone in IndexedDB, so it lives there keyed by a random folder
 * id; the id itself is the scalar key `a4:folder`. Each folder has its own
 * draft journal (prefix `a4:folder:<id>:`), so file drafts never mix with
 * library drafts.
 *
 * States: none → (open) → connected; on load, a remembered folder is
 * connected silently when the browser still grants access, otherwise it
 * waits in `reconnect` (a click calls `requestPermission`) or `not-found`.
 */

import { Journal, recoverDrafts, type Recovery } from "../autosave/index.ts";
import { FolderPageFiles } from "../store/folder.ts";
import type { KeyValue } from "../store/key-value.ts";
import { availableName, stamp } from "../store/names.ts";
import type { LockLike } from "../store/opfs.ts";
import { fileCopyName, type FilePath } from "../store/refs.ts";
import type { PageFiles, PageName, PageStore } from "../store/types.ts";
import { sheetFiles } from "./faithful.ts";

export const FOLDER_KEY = "a4:folder";

/** Where picked folder handles are kept. */
export interface HandleStore {
  get(id: string): Promise<FileSystemDirectoryHandle | null>;
  set(id: string, handle: FileSystemDirectoryHandle): Promise<void>;
  delete(id: string): Promise<void>;
  /** Every stored folder, so a re-picked folder can keep its id. */
  entries(): Promise<[string, FileSystemDirectoryHandle][]>;
}

export class MemoryHandleStore implements HandleStore {
  readonly map = new Map<string, FileSystemDirectoryHandle>();
  async get(id: string) {
    return this.map.get(id) ?? null;
  }
  async set(id: string, handle: FileSystemDirectoryHandle) {
    this.map.set(id, handle);
  }
  async delete(id: string) {
    this.map.delete(id);
  }
  async entries(): Promise<[string, FileSystemDirectoryHandle][]> {
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

/** A folder A4 can read and write. */
export interface ConnectedFolder {
  readonly id: string;
  readonly name: string;
  readonly handle: FileSystemDirectoryHandle;
  /** The exact backend. */
  readonly files: FolderPageFiles;
  /** What sessions use: sheet text, faithful saves. */
  readonly sheet: PageFiles<FilePath>;
  readonly journal: Journal<FilePath>;
}

export type FolderState =
  | { readonly status: "none" }
  | { readonly status: "unsupported" }
  | { readonly status: "connecting"; readonly name: string | null }
  | { readonly status: "reconnect"; readonly name: string }
  | { readonly status: "not-found"; readonly name: string | null }
  | { readonly status: "connected"; readonly name: string; readonly folder: ConnectedFolder };

interface PermissionHandle {
  queryPermission?(descriptor: { mode: "readwrite" }): Promise<PermissionState>;
  requestPermission?(descriptor: { mode: "readwrite" }): Promise<PermissionState>;
}

function errorName(error: unknown): string | undefined {
  return typeof error === "object" && error !== null ? (error as { name?: string }).name : undefined;
}

function newId(): string {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface FolderConnectionOptions {
  kv: KeyValue;
  handles: HandleStore;
  tabId: string;
  /** False when the browser has no folder picker. */
  supported: boolean;
  locks?: LockLike | null;
}

export class FolderConnection {
  readonly #kv: KeyValue;
  readonly #handles: HandleStore;
  readonly #tabId: string;
  readonly #supported: boolean;
  readonly #locks: LockLike | null | undefined;
  #state: FolderState;
  #id: string | null = null;
  #handle: FileSystemDirectoryHandle | null = null;
  readonly #listeners = new Set<(state: FolderState) => void>();

  constructor(options: FolderConnectionOptions) {
    this.#kv = options.kv;
    this.#handles = options.handles;
    this.#tabId = options.tabId;
    this.#supported = options.supported;
    this.#locks = options.locks;
    this.#state = options.supported ? { status: "none" } : { status: "unsupported" };
  }

  get state(): FolderState {
    return this.#state;
  }

  subscribe(listener: (state: FolderState) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #set(state: FolderState): FolderState {
    this.#state = state;
    for (const listener of this.#listeners) listener(state);
    return state;
  }

  #readId(): string | null {
    try {
      return this.#kv.get(FOLDER_KEY);
    } catch {
      return null;
    }
  }

  /** On load: reconnect the remembered folder if the browser still allows it. */
  async restore(): Promise<FolderState> {
    if (!this.#supported) return this.#set({ status: "unsupported" });
    const id = this.#readId();
    if (!id) return this.#set({ status: "none" });
    let handle: FileSystemDirectoryHandle | null = null;
    try {
      handle = await this.#handles.get(id);
    } catch {
      handle = null;
    }
    if (!handle) {
      this.#id = id;
      return this.#set({ status: "not-found", name: null });
    }
    this.#id = id;
    this.#handle = handle;
    this.#set({ status: "connecting", name: handle.name });
    let permission: PermissionState;
    try {
      permission = (await (handle as PermissionHandle).queryPermission?.({ mode: "readwrite" })) ?? "granted";
    } catch (error) {
      if (errorName(error) === "NotFoundError") return this.#set({ status: "not-found", name: handle.name });
      return this.#set({ status: "reconnect", name: handle.name });
    }
    if (permission !== "granted") return this.#set({ status: "reconnect", name: handle.name });
    return this.#connect(id, handle);
  }

  /** Ask the browser for access again. Call from a click. */
  async reconnect(): Promise<FolderState> {
    const handle = this.#handle;
    const id = this.#id;
    if (!handle || !id) return this.#state;
    let permission: PermissionState;
    try {
      permission = (await (handle as PermissionHandle).requestPermission?.({ mode: "readwrite" })) ?? "granted";
    } catch (error) {
      if (errorName(error) === "NotFoundError") return this.#set({ status: "not-found", name: handle.name });
      throw error;
    }
    if (permission !== "granted") return this.#set({ status: "reconnect", name: handle.name });
    return this.#connect(id, handle);
  }

  /**
   * Remember and connect a folder the user just picked. A folder A4 already
   * knows keeps its id, so tabs that opened it share locks and drafts.
   */
  async open(handle: FileSystemDirectoryHandle): Promise<FolderState> {
    const id = (await this.#knownId(handle)) ?? newId();
    await this.#handles.set(id, handle);
    try {
      this.#kv.set(FOLDER_KEY, id);
    } catch {
      // Storage unavailable: the folder works until reload.
    }
    this.#id = id;
    this.#handle = handle;
    return this.#connect(id, handle);
  }

  async #knownId(handle: FileSystemDirectoryHandle): Promise<string | null> {
    let known: [string, FileSystemDirectoryHandle][];
    try {
      known = await this.#handles.entries();
    } catch {
      return null;
    }
    for (const [id, stored] of known) {
      try {
        if (await stored.isSameEntry(handle)) return id;
      } catch {
        // A stored handle to a folder that is gone can't match.
      }
    }
    return null;
  }

  async #connect(id: string, handle: FileSystemDirectoryHandle): Promise<FolderState> {
    try {
      // Probe: a deleted or moved folder fails here, not halfway through a scan.
      for await (const entry of handle.entries()) {
        void entry;
        break;
      }
    } catch (error) {
      if (errorName(error) === "NotFoundError") return this.#set({ status: "not-found", name: handle.name });
      if (errorName(error) === "NotAllowedError") return this.#set({ status: "reconnect", name: handle.name });
      throw error;
    }
    const files = new FolderPageFiles(handle, { id, locks: this.#locks });
    const folder: ConnectedFolder = {
      id,
      name: handle.name,
      handle,
      files,
      sheet: sheetFiles(files),
      journal: this.journalFor(id),
    };
    return this.#set({ status: "connected", name: handle.name, folder });
  }

  journalFor(id: string): Journal<FilePath> {
    return new Journal<FilePath>(this.#kv, this.#tabId, { prefix: `a4:folder:${id}:` });
  }

  /** Recover drafts of this folder's files left by tabs that are gone. */
  async recover(library: PageStore, liveTabs: ReadonlySet<string> | null): Promise<Recovery<FilePath>[]> {
    if (this.#state.status !== "connected") return [];
    const { sheet, journal } = this.#state.folder;
    return recoverDrafts(sheet, journal, liveTabs, Date.now(), { copies: library, copyName: fileCopyName });
  }

  /**
   * Close or forget the folder. Callers flush open file sessions first. Drafts
   * left by tabs that are gone become library copies; then the folder is
   * forgotten. Returns the names of the copies.
   */
  async forget(library: PageStore, liveTabs: ReadonlySet<string> | null): Promise<PageName[]> {
    const copies: PageName[] = [];
    const id = this.#id ?? this.#readId();
    if (id) {
      const journal = this.journalFor(id);
      for (const draft of journal.all()) {
        if (draft.tabId !== this.#tabId && liveTabs?.has(draft.tabId)) continue;
        const name = await availableName(
          library,
          fileCopyName(draft.name, ` (recovered ${stamp(new Date(draft.at || Date.now()))})`),
        );
        await library.create(name, draft.text);
        journal.clearFor(draft.tabId, draft.name);
        copies.push(name);
      }
      await this.#handles.delete(id).catch(() => {});
    }
    try {
      this.#kv.remove(FOLDER_KEY);
    } catch {
      // Storage unavailable.
    }
    this.#id = null;
    this.#handle = null;
    this.#set(this.#supported ? { status: "none" } : { status: "unsupported" });
    return copies;
  }
}
