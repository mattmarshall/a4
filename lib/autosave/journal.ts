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

import type { KeyValue } from "../store/key-value.ts";
import type { PageName, Revision } from "../store/types.ts";

export interface Draft {
  tabId: string;
  name: PageName;
  text: string;
  base: Revision | null;
  at: number;
}

export class Journal {
  readonly tabId: string;
  readonly #kv: KeyValue;
  readonly #now: () => number;
  readonly #text: string;
  readonly #base: string;
  readonly #at: string;

  constructor(kv: KeyValue, tabId: string, options: { prefix?: string; now?: () => number } = {}) {
    if (tabId.includes(":")) throw new Error("Tab ids cannot contain ':'");
    const prefix = options.prefix ?? "a4:";
    this.#kv = kv;
    this.tabId = tabId;
    this.#now = options.now ?? Date.now;
    this.#text = `${prefix}draft:`;
    this.#base = `${prefix}draft-base:`;
    this.#at = `${prefix}draft-at:`;
  }

  /** Record a draft for this tab. Returns false if storage refused it. */
  set(name: PageName, text: string, base: Revision | null): boolean {
    const key = `${this.tabId}:${name}`;
    try {
      this.#kv.set(this.#text + key, text);
      this.#kv.set(this.#base + key, base ?? "");
      this.#kv.set(this.#at + key, String(this.#now()));
      return true;
    } catch {
      return false;
    }
  }

  get(name: PageName): Draft | null {
    return this.#read(this.tabId, name);
  }

  clear(name: PageName): void {
    this.clearFor(this.tabId, name);
  }

  clearFor(tabId: string, name: PageName): void {
    const key = `${tabId}:${name}`;
    try {
      this.#kv.remove(this.#text + key);
      this.#kv.remove(this.#base + key);
      this.#kv.remove(this.#at + key);
    } catch {
      // Storage unavailable; nothing to clear.
    }
  }

  /** Every draft in storage, from every tab. */
  all(): Draft[] {
    let keys: string[];
    try {
      keys = this.#kv.keys();
    } catch {
      return [];
    }
    const out: Draft[] = [];
    for (const key of keys) {
      if (!key.startsWith(this.#text)) continue;
      const rest = key.slice(this.#text.length);
      const colon = rest.indexOf(":");
      if (colon <= 0) continue;
      const draft = this.#read(rest.slice(0, colon), rest.slice(colon + 1) as PageName);
      if (draft) out.push(draft);
    }
    return out;
  }

  #read(tabId: string, name: PageName): Draft | null {
    const key = `${tabId}:${name}`;
    try {
      const text = this.#kv.get(this.#text + key);
      if (text === null) return null;
      const base = this.#kv.get(this.#base + key);
      return {
        tabId,
        name,
        text,
        base: base ? (base as Revision) : null,
        at: Number(this.#kv.get(this.#at + key) ?? 0),
      };
    } catch {
      return null;
    }
  }
}
