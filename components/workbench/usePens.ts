"use client";

/**
 * The pens' requests: Fit to page's and each installed pen's, one PenJob
 * each, owned here (above the inspector) so a request outlives the Models
 * panel. Every pen is wired the same way:
 *
 * - consent is granted, and the transform run, through the host, for the
 *   pen's own id;
 * - a job reads the pen's card, instruction, and the page's spec when it
 *   runs, so a pen updated meanwhile runs as it is now;
 * - a key the pen's service rejects is forgotten, so the panel asks again;
 * - the jobs of pens that were removed are cancelled and dropped.
 */

import { useEffect, useRef, useState } from "react";
import {
  FIT_TO_PAGE,
  type ModelCard,
  type ModelHost,
  Operation,
  PenJob,
  type PluginId,
  pluginIdOf,
  type TransformResult,
} from "@/lib/models";
import type { PageSpec } from "@/lib/page";
import type { PageRef } from "@/lib/persist";
import type { KeyStore } from "../FitToPage";
import type { CredentialStoreView } from "../PenControls";

/** A pen's credentials, as the host's credential store holds them (the host loads on first use). */
function credentialsOf(host: () => Promise<ModelHost>, id: PluginId): CredentialStoreView {
  return {
    has: async (kind) => (await host()).credentials.has(id, kind),
    set: async (kind, value) => (await host()).credentials.set(id, kind, value),
    forget: async (kind) => (await host()).credentials.forget(id, kind),
  };
}

export interface PenEntry {
  readonly card: ModelCard;
  readonly job: PenJob<PageRef>;
}

export interface Pens {
  /** Fit to page's request and its API key. */
  readonly fit: PenJob<PageRef>;
  readonly fitKey: KeyStore;
  /** An installed pen's request, made on first use. */
  job(card: ModelCard): PenJob<PageRef>;
  credentials(card: ModelCard): CredentialStoreView;
  /** The instruction an installed pen runs with: the author's choice, else its card's first. */
  instruction(card: ModelCard): string;
  setInstruction(card: ModelCard, instruction: string): void;
  /** Every pen with a request, Fit to page first: the top bar shows the running ones. */
  entries(): readonly PenEntry[];
}

export function usePens({
  host,
  installed,
  spec,
  onResult,
}: {
  host: () => Promise<ModelHost>;
  /** The installed pens' cards, as they are now. */
  installed: readonly ModelCard[];
  /** The active page's spec, which a rewrite must fit. */
  spec: PageSpec;
  /** Open a pen's result beside its source. */
  onResult: (card: ModelCard, result: TransformResult, ref: PageRef | null) => Promise<void>;
}): Pens {
  const [instructions, setInstructions] = useState<Record<string, string>>({});
  // What a job reads when it runs: the latest of each, not the ones it was made with.
  const latest = useRef({ spec, onResult, instructions, cards: new Map<string, ModelCard>() });
  useEffect(() => {
    latest.current = { spec, onResult, instructions, cards: new Map(installed.map((c) => [c.id, c])) };
  });

  const instructionOf = (card: ModelCard) =>
    latest.current.instructions[card.id] ?? card.transform?.instructions[0] ?? "";

  const [fit] = useState(() => {
    const id = FIT_TO_PAGE.id;
    const kind = FIT_TO_PAGE.names.credentials.apiKey;
    return new PenJob<PageRef>({
      grant: async (text) => (await host()).consent.request(id, Operation.TRANSFORM, text).approve(),
      run: async (text, options) =>
        (await host()).transform(id, text, latest.current.spec, {
          instruction: FIT_TO_PAGE.names.instructions.fit,
          ...options,
        }),
      onResult: (_name, result, ref) => latest.current.onResult(FIT_TO_PAGE.card, result, ref),
      onAuthFailed: () => void (async () => (await host()).credentials.forget(id, kind))(),
    });
  });
  const [fitKey] = useState((): KeyStore => {
    const view = credentialsOf(host, FIT_TO_PAGE.id);
    const kind = FIT_TO_PAGE.names.credentials.apiKey;
    return { has: () => view.has(kind), set: (value) => view.set(kind, value), forget: () => view.forget(kind) };
  });

  const jobs = useRef(new Map<string, PenEntry>());
  const job = (card: ModelCard): PenJob<PageRef> => {
    const existing = jobs.current.get(card.id);
    if (existing) return existing.job;
    const id = pluginIdOf(card);
    const current = () => latest.current.cards.get(card.id) ?? card;
    const made = new PenJob<PageRef>({
      grant: async (text) => (await host()).consent.request(id, Operation.TRANSFORM, text).approve(),
      run: async (text, options) =>
        (await host()).transform(id, text, latest.current.spec, { instruction: instructionOf(current()), ...options }),
      onResult: (_name, result, ref) => latest.current.onResult(current(), result, ref),
      onAuthFailed: () => {
        const view = credentialsOf(host, id);
        for (const c of current().credentials) void view.forget(c.kind);
      },
    });
    jobs.current.set(card.id, { card, job: made });
    return made;
  };

  // A pen that was removed: stop its request and forget its job.
  useEffect(() => {
    const ids = new Set(installed.map((c) => c.id));
    for (const [id, entry] of jobs.current) {
      if (ids.has(id)) continue;
      entry.job.cancel();
      jobs.current.delete(id);
    }
  }, [installed]);

  return {
    fit,
    fitKey,
    job,
    credentials: (card) => credentialsOf(host, pluginIdOf(card)),
    instruction: (card) => instructions[card.id] ?? card.transform?.instructions[0] ?? "",
    setInstruction: (card, instruction) => setInstructions((i) => ({ ...i, [card.id]: instruction })),
    entries: () => [
      { card: FIT_TO_PAGE.card, job: fit },
      ...[...jobs.current.values()].map((entry) => ({
        ...entry,
        card: latest.current.cards.get(entry.card.id) ?? entry.card,
      })),
    ],
  };
}
