/**
 * Key-value page store: pages as scalar string keys over a tiny `KeyValue`
 * interface. Backs the `localStorage` fallback and the in-memory store.
 *
 *   <prefix>page:<name>          page text
 *   <prefix>page-mtime:<name>    epoch ms of the last write
 *   <prefix>trash:<id>           trashed page text (id = "<name>.<trashedAt>")
 */

import { systemClock, type Clock } from "../../platform/clock.ts";
import { MemoryKeyValue, type KeyValue } from "../../platform/key-value.ts";
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

export interface KeyValuePageStoreOptions {
  kind?: StoreKind;
  durable?: boolean;
  prefix?: string;
  clock?: Clock;
}

export class KeyValuePageStore implements PageStore {
  readonly kind: StoreKind;
  readonly durable: boolean;
  readonly #kv: KeyValue;
  readonly #page: string;
  readonly #mtime: string;
  readonly #trash: string;
  readonly #clock: Clock;

  constructor(kv: KeyValue, options: KeyValuePageStoreOptions = {}) {
    const prefix = options.prefix ?? "a4:";
    this.#kv = kv;
    this.kind = options.kind ?? "memory";
    this.durable = options.durable ?? false;
    this.#page = `${prefix}page:`;
    this.#mtime = `${prefix}page-mtime:`;
    this.#trash = `${prefix}trash:`;
    this.#clock = options.clock ?? systemClock;
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
    const at = this.#clock.now();
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
      this.#clock.now(),
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
