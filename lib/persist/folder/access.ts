/**
 * Access to the open folder: a state machine over permissions.
 *
 *   none → (open) → connected
 *   on load, a remembered folder is connected silently when access is still
 *   granted, otherwise it waits in `reconnect` (a click calls
 *   `requestPermission`) or `not-found`.
 *
 * Which folder is remembered, and under which id, is the FolderRegistry's.
 * Each folder has its own draft journal (prefix `a4:folder:<id>:`), so file
 * drafts never mix with library drafts.
 */

import { Journal } from "../autosave/journal.ts";
import { recoverDrafts, type Recovery } from "../autosave/bootstrap.ts";
import type { CopyOutPolicy } from "../autosave/session.ts";
import { systemClock, type Clock } from "../../platform/clock.ts";
import type { KeyValue } from "../../platform/key-value.ts";
import type { Locks } from "../../platform/locks.ts";
import { FolderPageFiles } from "../store/folder.ts";
import { fileCopyName, filePathCodec, type FilePath } from "../store/refs.ts";
import { PageNotFoundError, type PageFiles, type PageName, type PageStore } from "../store/types.ts";
import { sheetFiles } from "./faithful.ts";
import { isFsError, type FolderFs, type FolderSource } from "./fs.ts";
import type { FolderRegistry } from "./registry.ts";

/** A folder A4 can read and write. */
export interface ConnectedFolder {
  readonly id: string;
  readonly name: string;
  /** The folder's files. */
  readonly fs: FolderFs;
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

export interface FolderAccessOptions<H> {
  registry: FolderRegistry<H>;
  source: FolderSource<H>;
  kv: KeyValue;
  tabId: string;
  /** False when the browser has no folder picker. */
  supported: boolean;
  locks: Locks | null;
  clock?: Clock;
}

/** A folder's files when it can't be reached: every read is "not found", so recovery copies drafts out. */
const unreachable: PageFiles<FilePath> = {
  kind: "folder",
  durable: true,
  list: async () => [],
  read: async (path) => {
    throw new PageNotFoundError(path);
  },
  create: async (path) => {
    throw new PageNotFoundError(path);
  },
  write: async (path) => {
    throw new PageNotFoundError(path);
  },
};

export class FolderAccess<H> {
  readonly #registry: FolderRegistry<H>;
  readonly #source: FolderSource<H>;
  readonly #kv: KeyValue;
  readonly #tabId: string;
  readonly #supported: boolean;
  readonly #locks: Locks | null;
  readonly #clock: Clock;
  #state: FolderState;
  #id: string | null = null;
  #handle: H | null = null;
  readonly #listeners = new Set<(state: FolderState) => void>();

  constructor(options: FolderAccessOptions<H>) {
    this.#registry = options.registry;
    this.#source = options.source;
    this.#kv = options.kv;
    this.#tabId = options.tabId;
    this.#supported = options.supported;
    this.#locks = options.locks;
    this.#clock = options.clock ?? systemClock;
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

  /** On load: reconnect the remembered folder if access is still granted. */
  async restore(): Promise<FolderState> {
    if (!this.#supported) return this.#set({ status: "unsupported" });
    const remembered = await this.#registry.remembered();
    if (!remembered) return this.#set({ status: "none" });
    this.#id = remembered.id;
    const { handle } = remembered;
    if (handle === null) return this.#set({ status: "not-found", name: null });
    this.#handle = handle;
    const name = this.#source.name(handle);
    this.#set({ status: "connecting", name });
    let permission: PermissionState;
    try {
      permission = await this.#source.queryPermission(handle);
    } catch (error) {
      if (isFsError(error, "not-found")) return this.#set({ status: "not-found", name });
      return this.#set({ status: "reconnect", name });
    }
    if (permission !== "granted") return this.#set({ status: "reconnect", name });
    return this.#connect(remembered.id, handle);
  }

  /** Ask for access again. Call from a click. */
  async reconnect(): Promise<FolderState> {
    const handle = this.#handle;
    const id = this.#id;
    if (handle === null || !id) return this.#state;
    const name = this.#source.name(handle);
    let permission: PermissionState;
    try {
      permission = await this.#source.requestPermission(handle);
    } catch (error) {
      if (isFsError(error, "not-found")) return this.#set({ status: "not-found", name });
      throw error;
    }
    if (permission !== "granted") return this.#set({ status: "reconnect", name });
    return this.#connect(id, handle);
  }

  /** Remember and connect a folder the user just picked. */
  async open(handle: H): Promise<FolderState> {
    const id = await this.#registry.remember(handle);
    this.#id = id;
    this.#handle = handle;
    return this.#connect(id, handle);
  }

  async #connect(id: string, handle: H): Promise<FolderState> {
    const fs = this.#source.open(handle);
    try {
      // Probe: a deleted or moved folder fails here, not halfway through a scan.
      for await (const entry of fs.entries("")) {
        void entry;
        break;
      }
    } catch (error) {
      if (isFsError(error, "not-found")) return this.#set({ status: "not-found", name: fs.name });
      if (isFsError(error, "not-allowed")) return this.#set({ status: "reconnect", name: fs.name });
      throw error;
    }
    const files = new FolderPageFiles(fs, { id, locks: this.#locks });
    const folder: ConnectedFolder = {
      id,
      name: fs.name,
      fs,
      files,
      sheet: sheetFiles(files),
      journal: this.journalFor(id),
    };
    return this.#set({ status: "connected", name: fs.name, folder });
  }

  journalFor(id: string): Journal<FilePath> {
    return new Journal(this.#kv, this.#tabId, filePathCodec, { prefix: `a4:folder:${id}:`, clock: this.#clock });
  }

  #copyOut(library: PageStore, libraryJournal: Journal<PageName>): CopyOutPolicy<FilePath> {
    return { kind: "copy-out", library, libraryJournal, copyName: fileCopyName };
  }

  /** Recover drafts of this folder's files left by tabs that are gone. */
  async recover(
    library: PageStore,
    libraryJournal: Journal<PageName>,
    liveTabs: ReadonlySet<string> | null,
  ): Promise<Recovery<FilePath>[]> {
    if (this.#state.status !== "connected") return [];
    const { sheet, journal } = this.#state.folder;
    return recoverDrafts(sheet, journal, this.#copyOut(library, libraryJournal), liveTabs, this.#clock.now());
  }

  /**
   * Close or forget the folder. Callers flush open file sessions first. Any
   * draft left (by this tab, or a tab that is gone) is recovered the way it is
   * on connect: saved to its file when the file is unchanged, otherwise kept
   * as a library copy (always, when the folder can't be reached). Then the
   * folder is forgotten. Returns the names of the copies.
   */
  async forget(
    library: PageStore,
    libraryJournal: Journal<PageName>,
    liveTabs: ReadonlySet<string> | null,
  ): Promise<PageName[]> {
    const id = this.#id ?? this.#registry.rememberedId();
    const copies: PageName[] = [];
    if (id) {
      const connected = this.#state.status === "connected" ? this.#state.folder : null;
      const recoveries = await recoverDrafts(
        connected?.sheet ?? unreachable,
        connected?.journal ?? this.journalFor(id),
        this.#copyOut(library, libraryJournal),
        // Unknown liveness: nothing else will recover these drafts once the folder is forgotten.
        liveTabs ?? new Set(),
        this.#clock.now(),
        { includeOwnTab: true },
      );
      for (const r of recoveries) if (r.kind === "copied" || r.kind === "recreated") copies.push(r.savedAs);
      await this.#registry.forget(id);
    }
    this.#id = null;
    this.#handle = null;
    this.#set(this.#supported ? { status: "none" } : { status: "unsupported" });
    return copies;
  }
}
