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
import type { Notify, Slot, SlotSnapshot } from "@/lib/workspace";

export interface SharedView {
  readonly pages: readonly SharedPageView[];
  /** Each page's seal, in the same order. */
  readonly seals: readonly SealOf[];
  /** Read-only snapshots for the stage: A, and B for a pair. */
  readonly slots: Readonly<Record<Slot, SlotSnapshot>>;
  /** Each page on its sender's preset and paper. */
  readonly specs: Readonly<Record<Slot, PageSpec>>;
}

const EMPTY: SlotSnapshot = { ref: null, name: null, label: null, text: "", status: "saved", readOnly: false };

function snapshotOf(page: SharedPageView): SlotSnapshot {
  return { ref: null, name: null, label: page.name, text: page.text, status: "saved", readOnly: true };
}

/** Remove the fragment from the address bar without reloading or adding a history entry. */
function clearFragment(): void {
  if (window.location.hash) {
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}`);
  }
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
          slots: { a: snapshotOf(a), b: b ? snapshotOf(b) : EMPTY },
          specs: { a: a.spec, b: (b ?? a).spec },
        });
      } catch (error) {
        if (run !== current) return;
        notify(error instanceof ShareError ? error.message : "This share link can’t be opened.", "warn");
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
