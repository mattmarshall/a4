/**
 * Startup: recover drafts left by tabs that are gone, migrate the old
 * single-page slots, and make sure a first-time library has a Welcome page.
 */

import type { KeyValue } from "../store/key-value.ts";
import { availableName, nameFromText, parsePageName, stamp } from "../store/names.ts";
import { isStoreError, type PageFiles, type PageName, type PageStore } from "../store/types.ts";
import type { Journal } from "./journal.ts";
import type { RelocationPolicy } from "./session.ts";

/** What happened to a draft another tab left behind. */
export type Recovery<Id extends string = PageName> =
  /** The page already had the draft's text, or the draft was saved over it. */
  | { readonly kind: "discarded" | "applied"; readonly page: Id }
  /**
   * The draft was saved as the library page `savedAs`: a copy, because the
   * page changed since the draft, or a re-creation, because the page is gone.
   */
  | { readonly kind: "copied" | "recreated"; readonly page: Id; readonly savedAs: PageName };

/** Drafts younger than this are left alone when tab liveness is unknown. */
export const STALE_DRAFT_MS = 60_000;

/**
 * Recover drafts from other tabs. `liveTabs` is the set of tab ids that are
 * still open (from Web Locks), or null when liveness can't be determined.
 * `policy` says where a draft goes when it can't be saved over its page, as
 * for a session over the same pages.
 */
export async function recoverDrafts<Id extends string = PageName>(
  files: PageFiles<Id>,
  journal: Journal<Id>,
  policy: RelocationPolicy<Id>,
  liveTabs: ReadonlySet<string> | null,
  now: number = Date.now(),
): Promise<Recovery<Id>[]> {
  const out: Recovery<Id>[] = [];
  const copies = policy.kind === "copy-out" ? policy.library : policy.store;
  const copyName = (id: Id, suffix: string) =>
    policy.kind === "copy-out" ? policy.copyName(id, suffix) : `${id}${suffix}`;
  const saveAs = async (desired: string, text: string): Promise<PageName> => {
    const name = await availableName(copies, desired);
    return (await copies.create(name, text)).name;
  };
  const recoveredName = (draft: { name: Id; at: number }) =>
    copyName(draft.name, ` (recovered ${stamp(new Date(draft.at || now))})`);
  for (const draft of journal.all()) {
    if (draft.tabId === journal.tabId) continue;
    if (liveTabs ? liveTabs.has(draft.tabId) : now - draft.at < STALE_DRAFT_MS) continue;
    let recovery: Recovery<Id>;
    try {
      const page = await files.read(draft.name);
      if (page.text === draft.text) {
        recovery = { kind: "discarded", page: draft.name };
      } else if (draft.base != null && page.revision === draft.base) {
        await files.write(draft.name, draft.text, draft.base);
        recovery = { kind: "applied", page: draft.name };
      } else {
        recovery = { kind: "copied", page: draft.name, savedAs: await saveAs(recoveredName(draft), draft.text) };
      }
    } catch (error) {
      if (
        policy.kind === "copy-out" &&
        (isStoreError(error, "not-found") || isStoreError(error, "unreadable") || isStoreError(error, "conflict"))
      ) {
        // A folder file that is gone or unreadable is never recreated.
        recovery = { kind: "recreated", page: draft.name, savedAs: await saveAs(recoveredName(draft), draft.text) };
      } else {
        if (!isStoreError(error, "not-found")) throw error;
        recovery = { kind: "recreated", page: draft.name, savedAs: await saveAs(copyName(draft.name, ""), draft.text) };
      }
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
export async function migrateLegacySlots(
  store: PageStore,
  kv: KeyValue,
  skipTexts: readonly string[],
): Promise<PageName[]> {
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
