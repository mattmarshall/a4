"use client";

/**
 * The Semantic repetition lens: a model lens that replaces the built-in lens
 * while it's on. It scores the shown pages once when it's turned on, then
 * 1,500 ms after a shown page's text (or its preset or size) stops changing.
 * `ScoreSchedule` skips duplicate requests and drops stale results.
 *
 * Planes don't survive a reload, so only built-in lenses are saved in settings.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { realScheduler } from "@/lib/persist";
import { type A4Plane, modelLens, type LensAttr } from "@/lib/render";
import { type ScoreResult, type PluginId, SEMANTIC_REPETITION, ScoreSchedule } from "@/lib/models";
import { isPaperId, isPresetId, type LensId, type PageSpec, pageSpec, PRESETS } from "@/lib/page";
import type { Notify, Slot } from "@/lib/workspace";
import type { ModelLegend } from "../MetricsPanel";
import type { SemanticSummary } from "../ModelsPanel";
import type { ModelsState } from "../useModels";

/** Rescore this long after the author stops typing. */
const RESCORE_MS = 1500;

const { id: SEMANTIC_ID, card: SEMANTIC_CARD, names: NAMES } = SEMANTIC_REPETITION;

/** The plane's legend, from the card: its scale, and what the marked values mean. */
function legendOf(): ModelLegend | null {
  const plane = SEMANTIC_CARD.score?.planes.find((p) => p.name === NAMES.plane);
  if (!plane) return null;
  const marks = plane.legend.map((stop) => `${stop.value.toFixed(2)} or more ${stop.label}.`);
  return {
    plane: plane.label,
    plugin: SEMANTIC_CARD.name,
    model: SEMANTIC_CARD.model,
    scale: `${plane.quantity} ${plane.min.toFixed(2)} → ${plane.max.toFixed(2)}`,
    note: [plane.description, ...marks].join(" "),
  };
}

const LEGEND = legendOf();

/** A page spec as a schedule key: its preset and paper, so a plane is only ever shown on the grid it was scored on. */
const specKey = (spec: PageSpec) => `${spec.id}/${spec.paper}`;

function specOfKey(key: string): PageSpec {
  const [id, paper] = key.split("/");
  return isPresetId(id) && isPaperId(paper) ? pageSpec(id, paper) : PRESETS.terminal;
}

type Scored = ScoreResult & { readonly spec: string };
type Planes = Readonly<Record<string, A4Plane>>;

/** Planes are keyed by plugin and plane name, so one plugin's planes never replace another's. */
const planeKey = (pluginId: PluginId, name: string) => `${pluginId}/${name}`;

/** A slot's planes for the sheet, when its latest result is for the slot's current spec. */
function planesOf(result: Scored | null, key: string): Planes | undefined {
  if (!result || result.spec !== key) return undefined;
  return Object.fromEntries(
    result.planes.map((p) => [planeKey(p.pluginId, p.name), { text: p.text, values: p.values, label: p.label }]),
  );
}

export interface SemanticLensInput {
  models: ModelsState;
  notify: Notify;
  texts: Readonly<Record<Slot, string>>;
  /** Each slot's page spec: its preset on its page's size. */
  specs: Readonly<Record<Slot, PageSpec>>;
  compare: boolean;
  /** The slot the inspector describes. */
  target: Slot;
  /** The built-in lens, shown while no model lens is on. */
  lens: LensId;
}

export function useSemanticLens({ models, notify, texts, specs, compare, target, lens }: SemanticLensInput) {
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
        score: (_slot, text, key) => latest.current.score(SEMANTIC_ID, text, specOfKey(key)),
        onResult: (slot, result, _text, key) => setScored((s) => ({ ...s, [slot]: { ...result, spec: key } })),
        onError: (_slot, error) =>
          latest.current.notify(
            `Semantic repetition: ${error instanceof Error ? error.message : String(error)}`,
            "warn",
          ),
      }),
  );
  useEffect(() => () => schedule.stop(), [schedule]);

  const available = models.status[SEMANTIC_ID] === "ready";
  const on = active === SEMANTIC_ID;
  const { a: textA, b: textB } = texts;
  const keyA = specKey(specs.a);
  const keyB = specKey(specs.b);
  useEffect(() => {
    if (!on || !available) return;
    schedule.changed("a", textA, keyA);
    if (compare) schedule.changed("b", textB, keyB);
  }, [schedule, on, available, textA, textB, keyA, keyB, compare]);

  const planesA = useMemo(() => planesOf(scored.a, keyA), [scored.a, keyA]);
  const planesB = useMemo(() => planesOf(scored.b, keyB), [scored.b, keyB]);

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
      restating: value(NAMES.scores.restating),
      units: value(NAMES.scores.units),
      pairs: result.findings.filter((f) => f.kind === NAMES.findings.similar),
      stale: result.planes[0]?.text !== texts[target] || result.spec !== specKey(specs[target]),
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
      setActive(SEMANTIC_ID);
      schedule.now("a", textA, keyA);
      if (compare) schedule.now("b", textB, keyB);
    },
    /** Turn the lens off (a built-in lens was chosen). */
    off() {
      setActive(null);
      schedule.stop();
    },
  };
}

export type SemanticLens = ReturnType<typeof useSemanticLens>;
