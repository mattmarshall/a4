"use client";

/**
 * The Semantic repetition lens: a model lens that replaces the built-in lens
 * while it's on. It scores the shown pages once when it's turned on, then
 * 1,500 ms after a shown page's text (or the preset) stops changing.
 * `ScoreSchedule` skips duplicate requests and drops stale results.
 *
 * Planes don't survive a reload, so only built-in lenses are saved in settings.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { realScheduler } from "@/lib/autosave";
import type { A4Plane } from "@/lib/element/a4-sheet";
import { modelLens, type LensAttr } from "@/lib/element/contract";
import type { LensId } from "@/lib/lenses";
import type { ScoreResult } from "@/lib/models/host";
import type { PluginId } from "@/lib/models/plugin-id";
import { SEMANTIC_REPETITION_CARD, SEMANTIC_REPETITION_ID } from "@/lib/models/semantic/card";
import { ScoreSchedule } from "@/lib/models/semantic/schedule";
import { PRESETS, type PageSpec, type PresetId } from "@/lib/page-spec";
import type { Notify } from "@/lib/workspace/errors";
import type { Slot } from "@/lib/workspace/types";
import type { ModelLegend } from "../MetricsPanel";
import type { SemanticSummary } from "../ModelsPanel";
import type { ModelsState } from "../useModels";

/** Rescore this long after the author stops typing. */
const RESCORE_MS = 1500;

const LEGEND: ModelLegend = {
  plane: "Semantic repetition",
  plugin: SEMANTIC_REPETITION_CARD.name,
  model: SEMANTIC_REPETITION_CARD.model,
  scale: "similarity 0.60 → 1.00",
  note: "Darker means closer in meaning. 0.85 or more counts as restating.",
};

type Scored = ScoreResult & { readonly preset: PresetId };
type Planes = Readonly<Record<string, A4Plane>>;

/** Planes are keyed by plugin and plane name, so one plugin's planes never replace another's. */
const planeKey = (pluginId: PluginId, name: string) => `${pluginId}/${name}`;

/** A slot's planes for the sheet, when its latest result is for the current preset. */
function planesOf(result: Scored | null, preset: PresetId): Planes | undefined {
  if (!result || result.preset !== preset) return undefined;
  return Object.fromEntries(
    result.planes.map((p) => [planeKey(p.pluginId, p.name), { text: p.text, values: p.values, label: p.label }]),
  );
}

export interface SemanticLensInput {
  models: ModelsState;
  notify: Notify;
  texts: Readonly<Record<Slot, string>>;
  spec: PageSpec;
  compare: boolean;
  /** The slot the inspector describes. */
  target: Slot;
  /** The built-in lens, shown while no model lens is on. */
  lens: LensId;
}

export function useSemanticLens({ models, notify, texts, spec, compare, target, lens }: SemanticLensInput) {
  const [active, setActive] = useState<PluginId | null>(null);
  const [scored, setScored] = useState<Record<Slot, Scored | null>>({ a: null, b: null });

  // The schedule lives as long as the Workbench and calls the latest score and notify.
  const latest = useRef({ score: models.score, notify });
  useEffect(() => {
    latest.current = { score: models.score, notify };
  });
  const [schedule] = useState(
    () =>
      new ScoreSchedule<Slot, ScoreResult>({
        scheduler: realScheduler,
        delayMs: RESCORE_MS,
        score: (_slot, text, preset) => latest.current.score(SEMANTIC_REPETITION_ID, text, PRESETS[preset as PresetId]),
        onResult: (slot, result, _text, preset) =>
          setScored((s) => ({ ...s, [slot]: { ...result, preset: preset as PresetId } })),
        onError: (_slot, error) =>
          latest.current.notify(
            `Semantic repetition: ${error instanceof Error ? error.message : String(error)}`,
            "warn",
          ),
      }),
  );
  useEffect(() => () => schedule.stop(), [schedule]);

  const available = models.status[SEMANTIC_REPETITION_ID] === "ready";
  const on = active === SEMANTIC_REPETITION_ID;
  const { a: textA, b: textB } = texts;
  useEffect(() => {
    if (!on || !available) return;
    schedule.changed("a", textA, spec.id);
    if (compare) schedule.changed("b", textB, spec.id);
  }, [schedule, on, available, textA, textB, spec.id, compare]);

  const planesA = useMemo(() => planesOf(scored.a, spec.id), [scored.a, spec.id]);
  const planesB = useMemo(() => planesOf(scored.b, spec.id), [scored.b, spec.id]);

  /** The plane a model lens shows: the plugin's first plane in either slot's latest result. */
  const lensPlane = (pluginId: PluginId) =>
    [scored.a, scored.b].flatMap((r) => r?.planes ?? []).find((p) => p.pluginId === pluginId)?.name ?? "";
  const sheetLens: LensAttr = active ? modelLens(planeKey(active, lensPlane(active))) : lens;

  const summary = ((): SemanticSummary | null => {
    if (!on) return null;
    const sheet = compare ? target.toUpperCase() : "";
    const result = scored[target];
    if (!result) return { sheet, restating: 0, units: 0, pairs: [], stale: true };
    const value = (name: string) => result.scores.find((x) => x.name === name)?.value ?? 0;
    return {
      sheet,
      restating: value("restating"),
      units: value("units"),
      pairs: result.findings.filter((f) => f.kind === "similar"),
      stale: result.planes[0]?.text !== texts[target] || result.preset !== spec.id,
    };
  })();

  return {
    /** The model lens shown, or null for the built-in lens. */
    active,
    /** The model is downloaded and loaded, so the lens can be offered. */
    available,
    sheetLens,
    planes: { a: planesA, b: planesB },
    legend: on ? LEGEND : null,
    summary,
    /** Turn the lens on and score the shown pages now. */
    show() {
      setActive(SEMANTIC_REPETITION_ID);
      schedule.now("a", textA, spec.id);
      if (compare) schedule.now("b", textB, spec.id);
    },
    /** Turn the lens off (a built-in lens was chosen). */
    off() {
      setActive(null);
      schedule.stop();
    },
  };
}

export type SemanticLens = ReturnType<typeof useSemanticLens>;
