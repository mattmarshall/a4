/**
 * Key-value page store: pages as scalar string keys over a tiny `KeyValue`
 * interface. Backs the `localStorage` fallback and the in-memory store.
 *
 *   <prefix>page:<name>          page text
 *   <prefix>page-mtime:<name>    epoch ms of the last write
 *   <prefix>trash:<id>           trashed page text (id = "<name>.<trashedAt>")
 */

import { nextAvailableName, pageNameCodec, parsePageName, sameName } from "./names.ts";
import { byteLength, revisionOf } from "./revision.ts";
import { makeTrashId, parseTrashId } from "./trash-ids.ts";
import {
  assertStorableText,
  PageConflictError,
  PageExistsError,
  PageNotFoundError,
  StoreUnavailableError,
  type Page,
  type PageName,
  type PageStore,
  type PageSummary,
  type Revision,
  type StoreKind,
  type TrashEntry,
  type TrashId,
  type WriteResult,
} from "./types.ts";

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

/** Adapter over the Web Storage API (`localStorage`). */
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

export interface KeyValuePageStoreOptions {
  kind?: StoreKind;
  durable?: boolean;
  prefix?: string;
  now?: () => number;
}

export class KeyValuePageStore implements PageStore {
  readonly kind: StoreKind;
  readonly durable: boolean;
  readonly #kv: KeyValue;
  readonly #page: string;
  readonly #mtime: string;
  readonly #trash: string;
  readonly #now: () => number;

  constructor(kv: KeyValue, options: KeyValuePageStoreOptions = {}) {
    const prefix = options.prefix ?? "a4:";
    this.#kv = kv;
    this.kind = options.kind ?? "memory";
    this.durable = options.durable ?? false;
    this.#page = `${prefix}page:`;
    this.#mtime = `${prefix}page-mtime:`;
    this.#trash = `${prefix}trash:`;
    this.#now = options.now ?? Date.now;
  }

  #names(): PageName[] {
    return this.#kv
      .keys()
      .filter((k) => k.startsWith(this.#page))
      .map((k) => pageNameCodec.parse(k.slice(this.#page.length)))
      .filter((n): n is PageName => n !== null);
  }

  #find(name: string): PageName | undefined {
    return this.#names().find((n) => sameName(n, name));
  }

  #summary(name: PageName, text: string): PageSummary {
    return {
      name,
      size: byteLength(text),
      modifiedAt: Number(this.#kv.get(this.#mtime + name) ?? 0),
    };
  }

  #put(name: PageName, text: string): WriteResult {
    const at = this.#now();
    try {
      this.#kv.set(this.#page + name, text);
      this.#kv.set(this.#mtime + name, String(at));
    } catch (error) {
      throw new StoreUnavailableError(`Could not save “${name}”: ${(error as Error).message}`);
    }
    return { name, size: byteLength(text), modifiedAt: at, revision: revisionOf(text) };
  }

  async list(): Promise<PageSummary[]> {
    return this.#names().map((name) => this.#summary(name, this.#kv.get(this.#page + name) ?? ""));
  }

  async read(name: PageName): Promise<Page> {
    const text = this.#kv.get(this.#page + name);
    if (text === null) throw new PageNotFoundError(name);
    return { ...this.#summary(name, text), text, revision: revisionOf(text) };
  }

  async create(name: PageName, text: string): Promise<WriteResult> {
    const valid = parsePageName(name);
    assertStorableText(valid, text);
    if (this.#find(valid)) throw new PageExistsError(valid);
    return this.#put(valid, text);
  }

  async write(name: PageName, text: string, expected?: Revision | null): Promise<WriteResult> {
    assertStorableText(name, text);
    const current = this.#kv.get(this.#page + name);
    if (current === null) throw new PageNotFoundError(name);
    if (expected != null) {
      const actual = revisionOf(current);
      if (actual !== expected) throw new PageConflictError(name, expected, actual);
    }
    return this.#put(name, text);
  }

  async rename(from: PageName, to: PageName): Promise<WriteResult> {
    const target = parsePageName(to);
    const text = this.#kv.get(this.#page + from);
    if (text === null) throw new PageNotFoundError(from);
    const clash = this.#find(target);
    if (clash && clash !== from) throw new PageExistsError(target);
    if (target === from) return { ...this.#summary(from, text), revision: revisionOf(text) };
    const result = this.#put(target, text);
    this.#kv.remove(this.#page + from);
    this.#kv.remove(this.#mtime + from);
    return result;
  }

  async trash(name: PageName): Promise<TrashEntry> {
    const text = this.#kv.get(this.#page + name);
    if (text === null) throw new PageNotFoundError(name);
    const { id, trashedAt } = makeTrashId(
      name,
      this.#now(),
      (candidate) => this.#kv.get(this.#trash + candidate) !== null,
    );
    this.#kv.set(this.#trash + id, text);
    this.#kv.remove(this.#page + name);
    this.#kv.remove(this.#mtime + name);
    return { id, name, size: byteLength(text), trashedAt };
  }

  async listTrash(): Promise<TrashEntry[]> {
    const out: TrashEntry[] = [];
    for (const k of this.#kv.keys()) {
      if (!k.startsWith(this.#trash)) continue;
      const parts = parseTrashId(k.slice(this.#trash.length));
      if (parts) out.push({ ...parts, size: byteLength(this.#kv.get(k) ?? "") });
    }
    return out;
  }

  async restore(id: TrashId): Promise<WriteResult> {
    const text = this.#kv.get(this.#trash + id);
    const parts = parseTrashId(id);
    if (text === null || !parts) throw new PageNotFoundError(id);
    const target = nextAvailableName(parts.name, this.#names());
    const result = this.#put(target, text);
    this.#kv.remove(this.#trash + id);
    return result;
  }

  async purge(id: TrashId): Promise<void> {
    if (this.#kv.get(this.#trash + id) === null) throw new PageNotFoundError(id);
    this.#kv.remove(this.#trash + id);
  }
}

export class MemoryPageStore extends KeyValuePageStore {
  constructor(options: Omit<KeyValuePageStoreOptions, "kind" | "durable"> = {}) {
    super(new MemoryKeyValue(), { ...options, kind: "memory", durable: false });
  }
}
