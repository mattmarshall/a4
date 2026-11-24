/**
 * Key-value page store: pages as scalar string keys over a tiny `KeyValue`
 * interface. Backs the `localStorage` fallback and the in-memory store.
 *
 *   <prefix>page:<name>          page text
 *   <prefix>page-mtime:<name>    epoch ms of the last write
 *   <prefix>trash:<id>           trashed page text (id = "<name>.<trashedAt>")
 */

import { systemClock, type Clock } from "../../platform/clock.ts";
import type { Locks } from "../../platform/locks.ts";
import { claimName, lockNames } from "./claims.ts";
import { MemoryKeyValue, type KeyValue } from "../../platform/key-value.ts";
import { pageNameCodec, parsePageName, sameName, sanitizePageName } from "./names.ts";
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
  /** Web Locks shared with other tabs (the localStorage backend), or null for none. */
  locks?: Locks | null;
}

export class KeyValuePageStore implements PageStore {
  readonly kind: StoreKind;
  readonly durable: boolean;
  readonly #kv: KeyValue;
  readonly #page: string;
  readonly #mtime: string;
  readonly #trash: string;
  readonly #clock: Clock;
  readonly #locks: Locks | null;

  constructor(kv: KeyValue, options: KeyValuePageStoreOptions = {}) {
    const prefix = options.prefix ?? "a4:";
    this.#kv = kv;
    this.kind = options.kind ?? "memory";
    this.durable = options.durable ?? false;
    this.#page = `${prefix}page:`;
    this.#mtime = `${prefix}page-mtime:`;
    this.#trash = `${prefix}trash:`;
    this.#clock = options.clock ?? systemClock;
    this.#locks = options.locks ?? null;
  }

  /** Hold `name` across tabs, under the same lock name as the OPFS store. */
  readonly #lock = <T>(name: string, fn: () => Promise<T>): Promise<T> => {
    if (!this.#locks) return fn();
    return this.#locks.request(`a4:page:${name.toLocaleLowerCase("en-US")}`, fn);
  };

  /** What `claimName` needs: the names taken now, and the lock. */
  readonly #claims = { names: async () => this.#names(), lock: this.#lock };

  /**
   * Create a page; the caller holds `name`'s lock. The check and the write
   * make no await, so they are atomic within a tab even without Web Locks.
   */
  #createHeld(name: PageName, text: string): WriteResult {
    if (this.#find(name)) throw new PageExistsError(name);
    return this.#put(name, text);
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
    return this.#lock(valid, async () => this.#createHeld(valid, text));
  }

  async createUnique(desired: string, text: string): Promise<WriteResult> {
    assertStorableText(sanitizePageName(desired), text);
    return claimName(desired, this.#claims, async (name) => this.#createHeld(name, text));
  }

  async write(name: PageName, text: string, expected?: Revision | null): Promise<WriteResult> {
    assertStorableText(name, text);
    return this.#lock(name, async () => {
      const current = this.#kv.get(this.#page + name);
      if (current === null) throw new PageNotFoundError(name);
      if (expected != null) {
        const actual = revisionOf(current);
        if (actual !== expected) throw new PageConflictError(name, expected, actual);
      }
      return this.#put(name, text);
    });
  }

  async rename(from: PageName, to: PageName): Promise<WriteResult> {
    const target = parsePageName(to);
    // Both names, so no other tab can take the target meanwhile.
    return lockNames(this.#lock, [from, target], async () => {
      const text = this.#kv.get(this.#page + from);
      if (text === null) throw new PageNotFoundError(from);
      const clash = this.#find(target);
      if (clash && clash !== from) throw new PageExistsError(target);
      if (target === from) return { ...this.#summary(from, text), revision: revisionOf(text) };
      // Keys are case-sensitive, so even a case-only rename writes a second key before removing the first.
      const result = this.#put(target, text);
      this.#kv.remove(this.#page + from);
      this.#kv.remove(this.#mtime + from);
      return result;
    });
  }

  async trash(name: PageName): Promise<TrashEntry> {
    return this.#lock(name, async () => {
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
    });
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
    return claimName(parts.name, this.#claims, async (target) => {
      const result = this.#createHeld(target, text);
      this.#kv.remove(this.#trash + id);
      return result;
    });
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
