"use client";

/**
 * The models list: every bundled plugin, what it does, where it runs, and
 * whether page text leaves the device, rendered from its card. A plugin's own
 * controls or summary go in its slot.
 */

import type { ReactNode } from "react";
import {
  BUNDLED_CARDS,
  type FindingResult,
  type ModelCard,
  type PlaneInfo,
  planeLevel,
  pluginIdOf,
  remoteHost,
  SEMANTIC_REPETITION,
} from "@/lib/models";
import { heatFill } from "@/lib/render";
import { InspectorSection } from "./InspectorSection";
import styles from "./ModelsPanel.module.css";
import type { ModelsState } from "./useModels";

/** "38.0 MB" (decimal megabytes, as download sizes are usually given). */
function formatBytes(bytes: number): string {
  if (bytes < 1_000_000) return `${Math.max(1, Math.round(bytes / 1000))} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

export function whereItRuns(card: ModelCard): string {
  const host = remoteHost(card);
  if (host !== null) return `Sends the page to ${host}, only after you confirm each request`;
  return "Runs in your browser; page text stays on this device";
}

/** A swatch showing the exact tint a value gets on the plane's sheet. */
export function HeatSwatch({ plane, value }: { plane: PlaneInfo; value: number }) {
  const fill = heatFill(planeLevel(plane, value));
  return (
    <span
      className="heat-swatch"
      aria-hidden="true"
      style={{ backgroundImage: fill ? `linear-gradient(${fill}, ${fill})` : undefined }}
    />
  );
}

export interface SemanticSummary {
  /** Which sheet the summary describes ("A", "B", or "" in single view). */
  sheet: string;
  restating: number;
  units: number;
  pairs: FindingResult[];
  /** True while a rescore for newer text is pending or running. */
  stale: boolean;
}

const { card: SEMANTIC_CARD, names: SEMANTIC_NAMES } = SEMANTIC_REPETITION;

/** The Semantic repetition summary: how much of the page restates itself, and the closest pairs. */
export function SemanticSummaryView({
  summary,
  onSelectPair,
}: {
  summary: SemanticSummary;
  onSelectPair: (pair: FindingResult) => void;
}) {
  const score = SEMANTIC_CARD.score;
  const plane = score?.planes.find((p) => p.name === SEMANTIC_NAMES.plane);
  if (!score || !plane) return null;
  const label = (name: string) => score.scores.find((x) => x.name === name)?.label ?? name;
  const restates = plane.legend[0]?.value ?? plane.max;
  const pairsLabel = score.findings.find((f) => f.kind === SEMANTIC_NAMES.findings.similar)?.label ?? "";
  return (
    <div className={styles.summary} aria-live="polite">
      <span className={styles.status}>
        {summary.sheet ? `Sheet ${summary.sheet}: ` : ""}
        {summary.stale
          ? "Rescoring…"
          : `${summary.restating === 0 ? "None" : summary.restating} of ${summary.units} ${label(SEMANTIC_NAMES.scores.units)} ${label(SEMANTIC_NAMES.scores.restating)} (${restates.toFixed(2)} or more).`}
      </span>
      {!summary.stale ? (
        summary.pairs.length ? (
          <>
            <span className={styles.status}>{pairsLabel}:</span>
            <ol className={styles.pairs}>
              {summary.pairs.map((pair) => (
                <li key={pair.spans.map((s) => `${s.start}-${s.end}`).join(" ")}>
                  <button
                    type="button"
                    className={styles.pair}
                    data-restates={pair.value >= restates ? "" : undefined}
                    onClick={() => onSelectPair(pair)}
                    title="Select the later sentence"
                  >
                    <HeatSwatch plane={plane} value={pair.value} />
                    <span className={styles.num}>{pair.value.toFixed(2)}</span>
                    <span>{pair.label}</span>
                  </button>
                </li>
              ))}
            </ol>
          </>
        ) : (
          <span className={styles.status}>No pairs score {plane.min.toFixed(2)} or more.</span>
        )
      ) : null}
    </div>
  );
}

export function ModelsPanel({
  models,
  scoreActive,
  onScore,
  slots,
}: {
  models: ModelsState;
  /** A model lens is showing. */
  scoreActive: boolean;
  onScore: (id: string) => void;
  /** Each plugin's own controls or summary, by plugin id, shown in its card. */
  slots: Readonly<Record<string, ReactNode>>;
}) {
  return (
    <InspectorSection
      id="models"
      title="Models"
      label="Models"
      defaultOpen={false}
      openWhen={scoreActive}
      className="models"
    >
      <ul className={styles.list}>
        {BUNDLED_CARDS.map((card) => {
          const status = models.status[card.id];
          const progress = models.progress[card.id];
          const error = models.errors[card.id];
          const size = Number(card.downloadBytes);
          return (
            <li key={card.id} className={styles.card} data-model={card.id} data-status={status ?? ""}>
              <strong>{card.name}</strong>
              <span>{card.description}</span>
              <span className={styles.where}>{whereItRuns(card)}</span>
              {card.model ? <span className={styles.where}>Model: {card.model}</span> : null}

              {status === "checking" ? <span className={styles.status}>Checking…</span> : null}
              {status === "not-downloaded" ? (
                <>
                  <span className={styles.status}>
                    Needs a one-time download of {formatBytes(size)}. It’s kept in this browser for later visits.
                  </span>
                  <div className="panel-actions">
                    <button
                      type="button"
                      className="btn btn-outline"
                      onClick={() => void models.prepare(pluginIdOf(card))}
                    >
                      Download ({formatBytes(size)})
                    </button>
                  </div>
                </>
              ) : null}
              {status === "downloading" ? (
                <span className={styles.status} aria-live="polite">
                  Downloading… {formatBytes(progress?.loaded ?? 0)} of {formatBytes(progress?.total || size)}
                  <progress max={progress?.total || size} value={progress?.loaded ?? 0} />
                </span>
              ) : null}
              {status === "ready" && card.score?.planes.length ? (
                <div className="panel-actions">
                  <button
                    type="button"
                    className="btn btn-outline"
                    aria-pressed={scoreActive}
                    onClick={() => onScore(card.id)}
                  >
                    {scoreActive ? "Rescore page" : "Show on the page"}
                  </button>
                </div>
              ) : null}
              {status === "error" ? <span className={styles.status}>Couldn’t start this model.</span> : null}
              {error ? (
                <span className={styles.status} role="alert">
                  {error}
                </span>
              ) : null}
              {slots[card.id] ?? null}
            </li>
          );
        })}
      </ul>
    </InspectorSection>
  );
}
