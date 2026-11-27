"use client";

/**
 * The pens: Fit to page and each installed pen, in `penCards` order, with
 * one PenJob each, owned here (above the inspector) so a request outlives the
 * Models panel. Every pen is built by one function:
 *
 * - consent is granted, and the transform run, through the host, for the
 *   pen's own id;
 * - a job reads the pen's card, instruction, and the page's spec when it
 *   runs, so a pen updated meanwhile runs as it is now;
 * - the instruction is the author's choice, else the card's first;
 * - a key the pen's service rejects is forgotten, with every other
 *   credential its card declares, so the panel asks again;
 * - the jobs of pens that were removed, in this tab or another, are
 *   cancelled and dropped.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
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
import { type PenSource, penCards } from "./pens";

/** A pen's credentials, as the host's credential store holds them (the host loads on first use). */
interface CredentialStoreView {
  has(kind: string): Promise<boolean>;
  set(kind: string, value: string): Promise<void>;
  forget(kind: string): Promise<void>;
}

/** One pen: its card, its request, its credentials, and the instruction it runs with. */
export interface Pen {
  readonly id: PluginId;
  /** The latest card, for a pen updated since its job was made. */
  readonly card: ModelCard;
  /** Who published it (its publisher note); null when it's built in. */
  readonly publisher: string | null;
  readonly job: PenJob<PageRef>;
  readonly credentials: CredentialStoreView;
  readonly instruction: string;
  setInstruction(instruction: string): void;
}

function credentialsOf(host: () => Promise<ModelHost>, id: PluginId): CredentialStoreView {
  return {
    has: async (kind) => (await host()).credentials.has(id, kind),
    set: async (kind, value) => (await host()).credentials.set(id, kind, value),
    forget: async (kind) => (await host()).credentials.forget(id, kind),
  };
}

export function usePens({
  host,
  installed,
  spec,
  onResult,
}: {
  host: () => Promise<ModelHost>;
  /** The installed plugins, as they are now, with their publisher notes; overlays are left out. */
  installed: readonly PenSource[];
  /** The active page's spec, which a rewrite must fit. */
  spec: PageSpec;
  /** Open a pen's result beside its source. */
  onResult: (card: ModelCard, result: TransformResult, ref: PageRef | null) => Promise<void>;
}): readonly Pen[] {
  const sources = useMemo(() => penCards(installed), [installed]);
  const [instructions, setInstructions] = useState<ReadonlyMap<PluginId, string>>(new Map());
  // What a job reads when it runs: the latest of each, not the ones it was made with.
  const latest = useRef({ spec, onResult, instructions, cards: new Map<PluginId, ModelCard>() });
  useEffect(() => {
    latest.current = {
      spec,
      onResult,
      instructions,
      cards: new Map(sources.map((s) => [pluginIdOf(s.card), s.card])),
    };
  });

  const jobs = useRef(new Map<PluginId, PenJob<PageRef>>());
  const jobOf = useCallback(
    (id: PluginId, card: ModelCard): PenJob<PageRef> => {
      const existing = jobs.current.get(id);
      if (existing) return existing;
      const current = () => latest.current.cards.get(id) ?? card;
      const made = new PenJob<PageRef>({
        grant: async (text) => (await host()).consent.request(id, Operation.TRANSFORM, text).approve(),
        run: async (text, options) =>
          (await host()).transform(id, text, latest.current.spec, {
            instruction: latest.current.instructions.get(id) ?? current().transform?.instructions[0] ?? "",
            ...options,
          }),
        onResult: (_name, result, ref) => latest.current.onResult(current(), result, ref),
        onAuthFailed: () => {
          const view = credentialsOf(host, id);
          for (const c of current().credentials) void view.forget(c.kind);
        },
      });
      jobs.current.set(id, made);
      return made;
    },
    [host],
  );

  // A pen that was removed: stop its request and forget its job.
  useEffect(() => {
    const ids = new Set(sources.map((s) => pluginIdOf(s.card)));
    for (const [id, job] of jobs.current) {
      if (ids.has(id)) continue;
      job.cancel();
      jobs.current.delete(id);
    }
  }, [sources]);

  return useMemo(
    () =>
      sources.map(({ card, publisher }) => {
        const id = pluginIdOf(card);
        return {
          id,
          card,
          publisher,
          job: jobOf(id, card),
          credentials: credentialsOf(host, id),
          instruction: instructions.get(id) ?? card.transform?.instructions[0] ?? "",
          setInstruction: (instruction: string) => setInstructions((all) => new Map(all).set(id, instruction)),
        };
      }),
    [sources, instructions, host, jobOf],
  );
}
