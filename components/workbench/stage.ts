/**
 * What the stage shows: the reader's own pages, or a share link's pages in
 * their place (README, "Share links").
 *
 * While a link is open, its pages show read-only on their sender's preset
 * and paper, a pair shows as Compare, and `editable` is false. Commands that
 * change the pages shown (typing, Clear, Swap, Duplicate A into B) are off,
 * because the reader's own pages stay open underneath, untouched, until the
 * shared view closes.
 */

import { type PageSpec, pageSpec, type PresetId, sizeOfName } from "../../lib/page/index.ts";
import type { Slot, SlotSnapshot } from "@/lib/workspace";
import type { StageSlot } from "./shared-slots";
import type { Layout } from "./useLayout";
import type { SharedView } from "./useSharedView";

export type { StageSlot } from "./shared-slots";

export interface Stage {
  /** The share link shown, if any. */
  readonly shared: SharedView | null;
  readonly slots: Readonly<Record<Slot, StageSlot>>;
  /** Each slot's page on its own size: the preset is the typeface, and the name says the paper. */
  readonly specs: Readonly<Record<Slot, PageSpec>>;
  readonly compare: boolean;
  readonly target: Slot;
  /** The layout as the top bar shows it. */
  readonly layout: Layout;
  /** Whether commands may change the pages shown: false while a share link is open. */
  readonly editable: boolean;
}

export function stageOf(
  own: Readonly<Record<Slot, SlotSnapshot>>,
  layout: Layout,
  presetId: PresetId,
  shared: SharedView | null,
): Stage {
  if (!shared) {
    return {
      shared: null,
      slots: own,
      // A `.a5` or `.a6` name is a card or a postcard.
      specs: {
        a: pageSpec(presetId, sizeOfName(own.a.label ?? "")),
        b: pageSpec(presetId, sizeOfName(own.b.label ?? "")),
      },
      compare: layout.compare,
      target: layout.target,
      layout,
      editable: true,
    };
  }
  const compare = shared.pages.length === 2;
  const target: Slot = compare ? layout.target : "a";
  return {
    shared,
    slots: shared.slots,
    specs: shared.specs,
    compare,
    target,
    layout: { ...layout, mode: compare ? "compare" : "single", compare, target },
    editable: false,
  };
}
