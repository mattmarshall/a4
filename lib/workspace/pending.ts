/**
 * Files remembered in a slot from the last visit wait for their folder to
 * connect. Meanwhile the slot shows a library page (the fallback), or nothing.
 */

import { sameRef, type PageRef } from "../persist/store/refs.ts";

export type Slot = "a" | "b";

export interface PendingFile {
  /** The remembered file. */
  readonly ref: PageRef;
  /** What the slot shows while waiting, or null if it shows nothing. */
  readonly fallback: PageRef | null;
}

/**
 * Whether a remembered file should reopen now that its folder connected:
 * only if the slot still shows its fallback (the user hasn't opened something
 * else). Slot B with no fallback isn't showing (Single view), so its file
 * waits until Compare opens B.
 */
export function shouldReopen(slot: Slot, pending: PendingFile, current: PageRef | null): boolean {
  if (pending.fallback) return sameRef(current, pending.fallback);
  return slot === "a" && current === null;
}
