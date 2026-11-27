"use client";

/**
 * The shared view: a share link's pages, shown read-only in place of the
 * reader's own (README, "Share links"). It's read from the URL's fragment
 * when the app loads and whenever the fragment changes. Nothing is stored:
 * the reader's library, folder, slots, and settings stay as they were, and
 * leaving the view removes the fragment so a reload doesn't reopen it.
 */

import { useCallback, useEffect, useState } from "react";
import type { PageSpec } from "@/lib/page";
import { isShareFragment, readLink, type SealOf, ShareError, type SharedPageView, sealOf } from "@/lib/share";
import type { Notify, Slot } from "@/lib/workspace";
import { SHARE_LINK_UNREADABLE } from "../share-copy";
import { clearFragment } from "./fragment";
import { type StageSlot, sharedSlots } from "./shared-slots";

export interface SharedView {
  readonly pages: readonly SharedPageView[];
  /** Each page's seal, in the same order. */
  readonly seals: readonly SealOf[];
  /** The slots for the stage: A shared, and B shared for a pair, else empty. */
  readonly slots: Readonly<Record<Slot, StageSlot>>;
  /** Each page on its sender's preset and paper. */
  readonly specs: Readonly<Record<Slot, PageSpec>>;
}

export function useSharedView(notify: Notify) {
  const [view, setView] = useState<SharedView | null>(null);

  useEffect(() => {
    let current = 0;
    const read = async () => {
      const run = ++current;
      const hash = window.location.hash;
      if (!isShareFragment(hash)) {
        setView(null);
        return;
      }
      try {
        const pages = await readLink(hash);
        const seals = await Promise.all(pages.map(sealOf));
        if (run !== current) return;
        const [a, b] = pages;
        if (!a) return;
        setView({
          pages,
          seals,
          slots: sharedSlots(a, b),
          specs: { a: a.spec, b: (b ?? a).spec },
        });
      } catch (error) {
        if (run !== current) return;
        notify(error instanceof ShareError ? error.message : SHARE_LINK_UNREADABLE, "warn");
        clearFragment();
        setView(null);
      }
    };
    void read();
    const onHash = () => void read();
    window.addEventListener("hashchange", onHash);
    return () => {
      current++;
      window.removeEventListener("hashchange", onHash);
    };
  }, [notify]);

  /** Leave the shared view: the reader's own pages show again, and the fragment goes. */
  const close = useCallback(() => {
    clearFragment();
    setView(null);
  }, []);

  return { view, close };
}
