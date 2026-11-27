/**
 * Which call the one consent dialog confirms: the model lens's pending
 * score, else the first pen whose request waits in `confirm`. The dialog is
 * modal, so only one call can be waiting. Send and Cancel go to that call's
 * own job (design: harden-pens-and-plugins, decision 2).
 */

import type { ModelCard, PenJob } from "../../lib/models/index.ts";
import type { ConsentRequest } from "../plugin-copy.ts";

/** A call waiting for the author's consent, and how to answer it. */
export interface PendingConsent {
  readonly request: ConsentRequest;
  send(): void;
  dismiss(): void;
}

/** What `pendingConsent` reads from a pen. */
export interface ConsentingPen<R> {
  readonly card: ModelCard;
  readonly publisher: string | null;
  readonly job: Pick<PenJob<R>, "getSnapshot" | "send" | "dismiss">;
}

/** The call the dialog confirms: `lens`'s pending score, else the first pen in `confirm`, else none. */
export function pendingConsent<R>(
  lens: PendingConsent | null,
  pens: readonly ConsentingPen<R>[],
): PendingConsent | null {
  if (lens) return lens;
  for (const { card, publisher, job } of pens) {
    const state = job.getSnapshot();
    if (state.kind !== "confirm") continue;
    return {
      request: { card, publisher, pageName: state.name, characters: state.text.length, action: "rewrite" },
      send: () => void job.send(),
      dismiss: () => job.dismiss(),
    };
  }
  return null;
}
