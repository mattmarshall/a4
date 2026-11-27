/**
 * A share link's pages as the stage's slots (README, "Share links"). A shared
 * page is a slot of its own kind: read-only, and not one of the reader's
 * pages, so it has no ref and nothing saves it. Only the stage holds one; the
 * workspace never does.
 */

import type { SharedPageView } from "../../lib/share/index.ts";
import type { Slot, SlotSnapshot } from "../../lib/workspace/index.ts";

/** A share link's page in a slot. */
interface SharedSlot {
  readonly kind: "shared";
  readonly ref: null;
  readonly name: null;
  readonly label: string;
  readonly text: string;
  readonly status: "saved";
  readonly readOnly: true;
}

/** What a slot on the stage shows: one of the reader's (empty, a library page, or a file), or a shared page. */
export type StageSlot = SlotSnapshot | SharedSlot;

const EMPTY: SlotSnapshot = {
  kind: "empty",
  ref: null,
  name: null,
  label: null,
  text: "",
  status: "saved",
  readOnly: false,
};

function sharedSlot(page: SharedPageView): SharedSlot {
  return { kind: "shared", ref: null, name: null, label: page.name, text: page.text, status: "saved", readOnly: true };
}

/** A link's page as A, and its second page as B, or an empty B for a single page. */
export function sharedSlots(a: SharedPageView, b: SharedPageView | undefined): Readonly<Record<Slot, StageSlot>> {
  return { a: sharedSlot(a), b: b ? sharedSlot(b) : EMPTY };
}
