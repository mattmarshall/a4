"use client";

/**
 * The call the one consent dialog confirms (`pendingConsent`), kept current:
 * it re-renders when a pen's request starts or stops waiting for consent, and
 * not on every progress update while a rewrite runs.
 */

import { useCallback, useSyncExternalStore } from "react";
import { type PendingConsent, pendingConsent } from "./consent";
import type { Pen } from "./usePens";

export function usePendingConsent(lens: PendingConsent | null, pens: readonly Pen[]): PendingConsent | null {
  const subscribe = useCallback(
    (listener: () => void) => {
      const stops = pens.map((pen) => pen.job.subscribe(listener));
      return () => {
        for (const stop of stops) stop();
      };
    },
    [pens],
  );
  // The waiting pen's state object: the same object until that pen's request changes.
  const waiting = () => pens.find((pen) => pen.job.getSnapshot().kind === "confirm")?.job.getSnapshot() ?? null;
  useSyncExternalStore(subscribe, waiting, waiting);
  return pendingConsent(lens, pens);
}
