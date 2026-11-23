"use client";

/**
 * The models list: every bundled plugin, what it does, where it runs, and
 * whether page text leaves the device, plus its controls and summary.
 */

import type { ReactNode } from "react";
import { Placement, type ModelCard } from "@/lib/gen/a4/v1/model_pb.js";
import { BUNDLED_CARDS, formatBytes } from "@/lib/models/cards";
import type { FindingResult } from "@/lib/models/host";
import { FIT_TO_PAGE_ID } from "@/lib/models/fit/card";
import { SEMANTIC_REPETITION_ID } from "@/lib/models/semantic/card";
import type { ModelsState } from "./useModels";

export function whereItRuns(card: ModelCard): string {
  if (card.sendsTextOffDevice) return `Sends the page to ${card.destinationHost}, only after you confirm each request`;
  if (card.placement === Placement.BROWSER) return "Runs in your browser; page text stays on this device";
  return "Runs on this device";
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

export function ModelsPanel({
  models,
  semanticActive,
  onScore,
  summary,
  onSelectPair,
  fit,
}: {
  models: ModelsState;
  /** The Semantic repetition lens is showing. */
  semanticActive: boolean;
  onScore: (id: string) => void;
  summary: SemanticSummary | null;
  onSelectPair: (pair: FindingResult) => void;
  /** Fit to page controls, shown in its card. */
  fit?: ReactNode;
}) {
  return (
    <section className="panel-section models" aria-label="Models">
      <h2 className="panel-title">Models</h2>
      <ul className="model-list">
        {BUNDLED_CARDS.map((card) => {
          const status = models.status[card.id];
          const progress = models.progress[card.id];
          const error = models.errors[card.id];
          const size = Number(card.downloadBytes);
          return (
            <li key={card.id} className="model-card" data-model={card.id} data-status={status ?? ""}>
              <strong>{card.name}</strong>
              <span>{card.description}</span>
              <span className="model-where">{whereItRuns(card)}</span>
              {card.model ? <span className="model-where">Model: {card.model}</span> : null}
              {card.id === FIT_TO_PAGE_ID ? fit : null}

              {status === "checking" ? <span className="model-status">Checking…</span> : null}
              {status === "not-downloaded" ? (
                <>
                  <span className="model-status">
                    Needs a one-time download of {formatBytes(size)}. It’s kept in this browser for later visits.
                  </span>
                  <div className="panel-actions">
                    <button type="button" className="btn btn-outline" onClick={() => void models.prepare(card.id)}>
                      Download ({formatBytes(size)})
                    </button>
                  </div>
                </>
              ) : null}
              {status === "downloading" ? (
                <span className="model-status" aria-live="polite">
                  Downloading… {formatBytes(progress?.loaded ?? 0)} of {formatBytes(progress?.total || size)}
                  <progress max={progress?.total || size} value={progress?.loaded ?? 0} />
                </span>
              ) : null}
              {status === "ready" && card.id === SEMANTIC_REPETITION_ID ? (
                <div className="panel-actions">
                  <button type="button" className="btn btn-outline" aria-pressed={semanticActive} onClick={() => onScore(card.id)}>
                    {semanticActive ? "Rescore page" : "Show on the page"}
                  </button>
                </div>
              ) : null}
              {status === "error" ? <span className="model-status">Couldn’t start this model.</span> : null}
              {error ? (
                <span className="model-status" role="alert">
                  {error}
                </span>
              ) : null}

              {card.id === SEMANTIC_REPETITION_ID && summary ? (
                <div className="model-summary" aria-live="polite">
                  <span className="model-status">
                    {summary.sheet ? `Sheet ${summary.sheet}: ` : ""}
                    {summary.stale
                      ? "Rescoring…"
                      : summary.restating === 0
                        ? `No restatements among ${summary.units} sentences and fields.`
                        : `${summary.restating} of ${summary.units} sentences and fields restate another.`}
                  </span>
                  {summary.pairs.length && !summary.stale ? (
                    <ol className="restate-list">
                      {summary.pairs.map((pair, i) => (
                        <li key={i}>
                          <button type="button" className="restate-pair" onClick={() => onSelectPair(pair)} title="Select the later sentence">
                            <span className="num">{pair.value.toFixed(2)}</span>
                            <span>{pair.label}</span>
                          </button>
                        </li>
                      ))}
                    </ol>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
