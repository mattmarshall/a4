/**
 * Startup: recover drafts left by tabs that are gone, migrate the old
 * single-page slots, and make sure a first-time library has a Welcome page.
 */

import type { KeyValue } from "../store/key-value.ts";
import { availableName, nameFromText, parsePageName, stamp } from "../store/names.ts";
import { isStoreError, type PageName, type PageStore } from "../store/types.ts";
import type { Journal } from "./journal.ts";

export type RecoveryKind = "applied" | "copied" | "recreated" | "discarded";

export interface Recovery {
  kind: RecoveryKind;
  /** The page the draft belonged to. */
  page: PageName;
  /** Where the draft now lives (same as `page` when applied). */
  savedAs: PageName | null;
}

/** Drafts younger than this are left alone when tab liveness is unknown. */
export const STALE_DRAFT_MS = 60_000;

/**
 * Recover drafts from other tabs. `liveTabs` is the set of tab ids that are
 * still open (from Web Locks), or null when liveness can't be determined.
 */
export async function recoverDrafts(
  store: PageStore,
  journal: Journal,
  liveTabs: ReadonlySet<string> | null,
  now: number = Date.now(),
): Promise<Recovery[]> {
  const out: Recovery[] = [];
  for (const draft of journal.all()) {
    if (draft.tabId === journal.tabId) continue;
    if (liveTabs ? liveTabs.has(draft.tabId) : now - draft.at < STALE_DRAFT_MS) continue;
    let recovery: Recovery;
    try {
      const page = await store.read(draft.name);
      if (page.text === draft.text) {
        recovery = { kind: "discarded", page: draft.name, savedAs: draft.name };
      } else if (draft.base && page.revision === draft.base) {
        await store.write(draft.name, draft.text, draft.base);
        recovery = { kind: "applied", page: draft.name, savedAs: draft.name };
      } else {
        const name = await availableName(store, `${draft.name} (recovered ${stamp(new Date(draft.at || now))})`);
        await store.create(name, draft.text);
        recovery = { kind: "copied", page: draft.name, savedAs: name };
      }
    } catch (error) {
      if (!isStoreError(error, "not-found")) throw error;
      const name = await availableName(store, draft.name);
      await store.create(name, draft.text);
      recovery = { kind: "recreated", page: draft.name, savedAs: name };
    }
    journal.clearFor(draft.tabId, draft.name);
    out.push(recovery);
  }
  return out;
}

export const LEGACY_SLOT_KEYS = ["a4:text:a", "a4:text:b"] as const;
export const MIGRATED_KEY = "a4:migrated";

/**
 * Import text from the pre-library page A/B slots as pages named after their
 * first line. Skips empty slots and bundled sample text. Runs once; the old
 * keys are kept.
 */
export async function migrateLegacySlots(store: PageStore, kv: KeyValue, skipTexts: readonly string[]): Promise<PageName[]> {
  try {
    if (kv.get(MIGRATED_KEY)) return [];
  } catch {
    return [];
  }
  const created: PageName[] = [];
  for (const key of LEGACY_SLOT_KEYS) {
    let text: string | null = null;
    try {
      text = kv.get(key);
    } catch {
      text = null;
    }
    if (!text || text.trim() === "" || skipTexts.includes(text)) continue;
    const name = await availableName(store, nameFromText(text, key.endsWith("a") ? "Page A" : "Page B"));
    await store.create(name, text);
    created.push(name);
  }
  try {
    kv.set(MIGRATED_KEY, "1");
  } catch {
    // Not fatal: a rerun skips texts that already exist as pages by name.
  }
  return created;
}

export const WELCOME_PAGE_NAME = parsePageName("Welcome");

/** Create and return the Welcome page if the library is empty. */
export async function ensureFirstPage(store: PageStore, welcomeText: string): Promise<PageName | null> {
  if ((await store.list()).length > 0) return null;
  const result = await store.create(WELCOME_PAGE_NAME, welcomeText);
  return result.name;
}
