"use client";

/**
 * Model lenses: one for each plane an overlay declares (Semantic repetition,
 * or an installed plugin's). A model lens replaces the built-in lens while
 * it's on.
 *
 * - An overlay that keeps text on the device scores the shown pages when its
 *   lens turns on, then 1,500 ms after a shown page's text (or its preset or
 *   size) stops changing. `ScoreSchedule` skips duplicate requests and drops
 *   stale results.
 * - An overlay that sends text off the device scores only when the author
 *   asks: turning its lens on, or Score again, opens the consent dialog for
 *   the page the inspector describes. Nothing is sent while the author types.
 *
 * Planes don't survive a reload, so only built-in lenses are saved in settings.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { type FindingResult, Operation, type ScoreResult, SEMANTIC_REPETITION, ScoreSchedule } from "@/lib/models";
import { isPaperId, isPresetId, type LensId, type PageSpec, pageSpec, PRESETS } from "@/lib/page";
import { realScheduler } from "@/lib/persist";
import { type A4Plane, type LensAttr, modelLens } from "@/lib/render";
import type { Notify, Slot } from "@/lib/workspace";
import type { SemanticSummary } from "../ModelsPanel";
import type { ModelsState } from "../useModels";
import { type LensSource, legendOf, planeKey, rescoresWhileTyping } from "./model-lens";

/** Rescore this long after the author stops typing. */
const RESCORE_MS = 1500;

const SEMANTIC_NAMES = SEMANTIC_REPETITION.names;

/** A page spec as a schedule key: its preset and paper, so a plane is only ever shown on the grid it was scored on. */
const specKey = (spec: PageSpec) => `${spec.id}/${spec.paper}`;

function specOfKey(key: string): PageSpec {
  const [id, paper] = key.split("/");
  return isPresetId(id) && isPaperId(paper) ? pageSpec(id, paper) : PRESETS.terminal;
}

type Scored = ScoreResult & { readonly spec: string };
type Planes = Readonly<Record<string, A4Plane>>;

/** A slot's planes for the sheet, when its latest result is for the slot's current spec. */
function planesOf(result: Scored | null, key: string): Planes | undefined {
  if (!result || result.spec !== key) return undefined;
  return Object.fromEntries(
    result.planes.map((p) => [planeKey(p.pluginId, p.name), { text: p.text, values: p.values, label: p.label }]),
  );
}

/** A remote overlay's request, waiting for the author's consent. */
export interface LensConsent {
  readonly source: LensSource;
  readonly slot: Slot;
  readonly text: string;
  readonly spec: PageSpec;
}

export interface ModelLensInput {
  models: ModelsState;
  notify: Notify;
  /** The planes the lens bar offers, from overlays that are ready. */
  sources: readonly LensSource[];
  texts: Readonly<Record<Slot, string>>;
  /** Each slot's page spec: its preset on its page's size. */
  specs: Readonly<Record<Slot, PageSpec>>;
  compare: boolean;
  /** The slot the inspector describes. */
  target: Slot;
  /** The built-in lens, shown while no model lens is on. */
  lens: LensId;
}

export function useModelLens({ models, notify, sources, texts, specs, compare, target, lens }: ModelLensInput) {
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [scored, setScored] = useState<Record<Slot, Scored | null>>({ a: null, b: null });
  const [consent, setConsent] = useState<LensConsent | null>(null);
  const active = sources.find((s) => planeKey(s.pluginId, s.plane) === activeKey) ?? null;

  // The schedule lives as long as the Workbench and calls the latest score, notify, and lens.
  const latest = useRef({ score: models.score, notify, active });
  useEffect(() => {
    latest.current = { score: models.score, notify, active };
  });
  const [schedule] = useState(
    () =>
      new ScoreSchedule<Slot, ScoreResult>({
        scheduler: realScheduler,
        delayMs: RESCORE_MS,
        score: (_slot, text, key) => {
          const source = latest.current.active;
          if (!source) return Promise.reject(new Error("No model lens is on."));
          return latest.current.score(source.pluginId, text, specOfKey(key));
        },
        onResult: (slot, result, _text, key) => setScored((s) => ({ ...s, [slot]: { ...result, spec: key } })),
        onError: (_slot, error) =>
          latest.current.notify(
            `${latest.current.active?.card.name ?? "Model"}: ${error instanceof Error ? error.message : String(error)}`,
            "warn",
          ),
      }),
  );
  useEffect(() => () => schedule.stop(), [schedule]);

  // A lens whose plugin went away (removed, or no longer ready) turns off.
  useEffect(() => {
    if (activeKey && !active) {
      setActiveKey(null);
      schedule.stop();
    }
  }, [activeKey, active, schedule]);

  const local = active !== null && rescoresWhileTyping(active.card);
  const { a: textA, b: textB } = texts;
  const keyA = specKey(specs.a);
  const keyB = specKey(specs.b);
  useEffect(() => {
    if (!local) return;
    schedule.changed("a", textA, keyA);
    if (compare) schedule.changed("b", textB, keyB);
  }, [schedule, local, textA, textB, keyA, keyB, compare]);

  const planesA = useMemo(() => planesOf(scored.a, keyA), [scored.a, keyA]);
  const planesB = useMemo(() => planesOf(scored.b, keyB), [scored.b, keyB]);
  const sheetLens: LensAttr = active ? modelLens(planeKey(active.pluginId, active.plane)) : lens;

  const summary = ((): SemanticSummary | null => {
    if (active?.pluginId !== SEMANTIC_REPETITION.id) return null;
    const sheet = compare ? target.toUpperCase() : "";
    const result = scored[target];
    if (!result) return { sheet, restating: 0, units: 0, pairs: [], stale: true };
    const value = (name: string) => result.scores.find((x) => x.name === name)?.value ?? 0;
    return {
      sheet,
      restating: value(SEMANTIC_NAMES.scores.restating),
      units: value(SEMANTIC_NAMES.scores.units),
      pairs: result.findings.filter((f): f is FindingResult => f.kind === SEMANTIC_NAMES.findings.similar),
      stale: result.planes[0]?.text !== texts[target] || result.spec !== specKey(specs[target]),
    };
  })();

  /** Ask to score the inspector's page with a remote overlay: the consent dialog opens. */
  const askRemote = (source: LensSource) => {
    const text = texts[target];
    if (!text.trim()) return;
    setConsent({ source, slot: target, text, spec: specs[target] });
  };

  /** The remote lens's result is for text the page no longer has. */
  const remoteStale = active !== null && !local && (scored[target]?.planes[0]?.text ?? null) !== texts[target];

  return {
    /** The plane shown, or null for the built-in lens. */
    active,
    sources,
    sheetLens,
    planes: { a: planesA, b: planesB },
    legend: active ? legendOf(active) : null,
    summary,
    /** A remote overlay's request waiting for consent, for the dialog. */
    consent,
    /** The remote lens shows an older page's scores, so it offers Score again. */
    remoteStale,
    /** Turn a plane's lens on: score the shown pages now, or ask for consent first. */
    show(source: LensSource) {
      const key = planeKey(source.pluginId, source.plane);
      if (key !== activeKey) {
        schedule.stop();
        setScored({ a: null, b: null });
      }
      setActiveKey(key);
      latest.current = { ...latest.current, active: source };
      if (rescoresWhileTyping(source.card)) {
        schedule.now("a", textA, keyA);
        if (compare) schedule.now("b", textB, keyB);
      } else {
        askRemote(source);
      }
    },
    /** Ask again for a remote lens, for the page as it is now. */
    rescore() {
      if (active && !local) askRemote(active);
    },
    /** The consent dialog's Send: approve this one call, and score. */
    async send() {
      const request = consent;
      if (!request) return;
      setConsent(null);
      try {
        const token = await models.approve(request.source.pluginId, Operation.SCORE, request.text);
        const result = await models.score(request.source.pluginId, request.text, request.spec, token);
        setScored((s) => ({ ...s, [request.slot]: { ...result, spec: specKey(request.spec) } }));
      } catch (error) {
        notify(`${request.source.card.name}: ${error instanceof Error ? error.message : String(error)}`, "warn");
      }
    },
    /** The consent dialog's Cancel: nothing is sent. */
    cancel() {
      setConsent(null);
      if (!scored[target]) setActiveKey(null);
    },
    /** Turn the lens off (a built-in lens was chosen). */
    off() {
      setActiveKey(null);
      setConsent(null);
      schedule.stop();
    },
  };
}

export type ModelLens = ReturnType<typeof useModelLens>;
