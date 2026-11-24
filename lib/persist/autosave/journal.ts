/**
 * The edit journal: a synchronous, per-tab copy of every unsaved edit.
 *
 * Entries live in localStorage as scalar keys (no serialized record):
 *   a4:draft:<tabId>:<name>        draft text
 *   a4:draft-base:<tabId>:<name>   revision the draft was based on ("" = none)
 *   a4:draft-at:<tabId>:<name>     epoch ms of the last edit
 *
 * localStorage writes are synchronous, so a draft survives a crash that
 * happens right after the keystroke. Entries are cleared only after the page
 * store confirms a save of the same text.
 */

import { systemClock, type Clock } from "../../platform/clock.ts";
import type { KeyValue } from "../../platform/key-value.ts";
import { parseRevision } from "../store/revision.ts";
import type { IdCodec, PageName, Revision } from "../store/types.ts";

export interface Draft<Id extends string = PageName> {
  tabId: string;
  name: Id;
  text: string;
  base: Revision | null;
  at: number;
}

/**
 * Generic over the page identifier: page names, or file paths for a folder.
 * `codec` reads identifiers back from keys; an entry whose key or base
 * revision doesn't parse is skipped or treated as having no base.
 */
export class Journal<Id extends string = PageName> {
  readonly tabId: string;
  readonly #kv: KeyValue;
  readonly #codec: IdCodec<Id>;
  readonly #clock: Clock;
  readonly #text: string;
  readonly #base: string;
  readonly #at: string;

  constructor(kv: KeyValue, tabId: string, codec: IdCodec<Id>, options: { prefix?: string; clock?: Clock } = {}) {
    if (tabId.includes(":")) throw new Error("Tab ids cannot contain ':'");
    const prefix = options.prefix ?? "a4:";
    this.#kv = kv;
    this.#codec = codec;
    this.tabId = tabId;
    this.#clock = options.clock ?? systemClock;
    this.#text = `${prefix}draft:`;
    this.#base = `${prefix}draft-base:`;
    this.#at = `${prefix}draft-at:`;
  }

  /** Record a draft for this tab. Returns false if storage refused it. */
  set(name: Id, text: string, base: Revision | null): boolean {
    const key = this.#key(this.tabId, name);
    try {
      this.#kv.set(this.#text + key, text);
      this.#kv.set(this.#base + key, base ?? "");
      this.#kv.set(this.#at + key, String(this.#clock.now()));
      return true;
    } catch {
      return false;
    }
  }

  get(name: Id): Draft<Id> | null {
    return this.#read(this.tabId, name);
  }

  clear(name: Id): void {
    this.clearFor(this.tabId, name);
  }

  clearFor(tabId: string, name: Id): void {
    const key = this.#key(tabId, name);
    try {
      this.#kv.remove(this.#text + key);
      this.#kv.remove(this.#base + key);
      this.#kv.remove(this.#at + key);
    } catch {
      // Storage unavailable; nothing to clear.
    }
  }

  /** Every draft in storage, from every tab. */
  all(): Draft<Id>[] {
    let keys: string[];
    try {
      keys = this.#kv.keys();
    } catch {
      return [];
    }
    const out: Draft<Id>[] = [];
    for (const key of keys) {
      if (!key.startsWith(this.#text)) continue;
      const rest = key.slice(this.#text.length);
      const colon = rest.indexOf(":");
      if (colon <= 0) continue;
      const name = this.#codec.parse(rest.slice(colon + 1));
      const draft = name === null ? null : this.#read(rest.slice(0, colon), name);
      if (draft) out.push(draft);
    }
    return out;
  }

  #key(tabId: string, name: Id): string {
    return `${tabId}:${this.#codec.format(name)}`;
  }

  #read(tabId: string, name: Id): Draft<Id> | null {
    const key = this.#key(tabId, name);
    try {
      const text = this.#kv.get(this.#text + key);
      if (text === null) return null;
      const base = this.#kv.get(this.#base + key);
      return {
        tabId,
        name,
        text,
        base: base === null ? null : parseRevision(base),
        at: Number(this.#kv.get(this.#at + key) ?? 0),
      };
    } catch {
      return null;
    }
  }
}
