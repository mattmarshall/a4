/** What the Pages panel's library and folder sections share: where pages are open, and how dates and sizes read. */

import { type PageRef, sameRef } from "@/lib/persist";
import { SLOTS, type Slot } from "@/lib/workspace";

export interface Placement {
  /** What each shown slot holds (B is null in Single). */
  readonly open: Readonly<Record<Slot, PageRef | null>>;
  readonly compare: boolean;
  readonly activeSlot: Slot;
}

/** The shown slot holding `ref`, if any. */
export function slotOf(placement: Placement, ref: PageRef): Slot | null {
  return SLOTS.find((slot) => sameRef(placement.open[slot], ref)) ?? null;
}

export const otherSlot = (slot: Slot): Slot => (slot === "a" ? "b" : "a");

export function relativeTime(ms: number, now: number = Date.now()): string {
  const s = Math.round((now - ms) / 1000);
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d === 1) return "yesterday";
  if (d < 7) return `${d} days ago`;
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function formatSize(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}
