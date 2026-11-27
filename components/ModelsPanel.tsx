"use client";

/**
 * The models list: every bundled and installed plugin, what it does, where it
 * runs, and whether page text leaves the device, rendered from its card. A
 * plugin's own controls or summary go in its slot. Its words come from
 * plugin-copy.ts (`modelsPanel`).
 */

import { type ReactNode, useState } from "react";
import {
  BUNDLED_CARDS,
  type FindingResult,
  type Inspection,
  type ModelCard,
  NO_SANDBOX,
  type PlaneInfo,
  planeLevel,
  type PluginId,
  pluginIdOf,
  SEMANTIC_REPETITION,
} from "@/lib/models";
import { heatFill } from "@/lib/render";
import { InspectorSection } from "./InspectorSection";
import styles from "./ModelsPanel.module.css";
import { PluginInstallDialog } from "./PluginInstallDialog";
import { modelsPanel, publisherNote, whereItRuns } from "./plugin-copy";
import type { InstalledView, ModelsState } from "./useModels";

/** A swatch showing the exact tint a value gets on the plane's sheet. */
function HeatSwatch({ plane, value }: { plane: PlaneInfo; value: number }) {
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
      {!summary.stale && summary.pairs.length > 0 ? (
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
      ) : null}
      {!summary.stale && summary.pairs.length === 0 ? (
        <span className={styles.status}>No pairs score {plane.min.toFixed(2)} or more.</span>
      ) : null}
    </div>
  );
}

/** One plugin's card: what it is, its download, and its controls. */
function PluginCard({
  card,
  models,
  scoreActive,
  onScore,
  installed,
  onCheckForUpdate,
  onRemove,
  children,
}: {
  card: ModelCard;
  models: ModelsState;
  scoreActive: boolean;
  onScore: (id: PluginId) => void;
  installed: InstalledView | null;
  onCheckForUpdate: (id: PluginId) => void;
  onRemove: (id: PluginId) => void;
  children: ReactNode;
}) {
  const id = pluginIdOf(card);
  const status = models.status.get(id);
  const progress = models.progress.get(id);
  const error = models.errors.get(id);
  const size = Number(card.downloadBytes);
  const blocked = installed !== null && models.sandbox === "unavailable";
  return (
    <li className={styles.card} data-model={card.id} data-status={status ?? ""}>
      <strong>
        {card.name}
        {installed ? <span className={styles.version}> {card.version}</span> : null}
      </strong>
      <span>{card.description}</span>
      <span className={styles.where}>{whereItRuns(card)}</span>
      {card.model ? <span className={styles.where}>{modelsPanel.model(card.model)}</span> : null}
      {installed ? (
        <>
          <span className={styles.where}>
            {installed.knownName ? <span className={styles.badge}>{modelsPanel.knownPublisher}</span> : null}{" "}
            {publisherNote(installed.knownName, installed.publisherName)}
          </span>
          <span className={styles.where}>
            {modelsPanel.fingerprint} <code>{installed.fingerprint}</code>
          </span>
        </>
      ) : null}
      {blocked ? <span className={styles.status}>{NO_SANDBOX}</span> : null}

      {!blocked && status === "checking" ? <span className={styles.status}>{modelsPanel.checking}</span> : null}
      {!blocked && status === "not-downloaded" ? (
        <>
          <span className={styles.status}>{modelsPanel.downloadNote(size)}</span>
          <div className="panel-actions">
            <button type="button" className="btn btn-outline" onClick={() => void models.prepare(id)}>
              {modelsPanel.download(size)}
            </button>
          </div>
        </>
      ) : null}
      {!blocked && status === "downloading" ? (
        <span className={styles.status} aria-live="polite">
          {modelsPanel.downloading(progress?.loaded ?? 0, progress?.total || size)}
          <progress max={progress?.total || size} value={progress?.loaded ?? 0} />
        </span>
      ) : null}
      {!blocked && status === "ready" && card.score?.planes.length ? (
        <div className="panel-actions">
          <button type="button" className="btn btn-outline" aria-pressed={scoreActive} onClick={() => onScore(id)}>
            {scoreActive ? modelsPanel.rescore : modelsPanel.showLens}
          </button>
        </div>
      ) : null}
      {status === "error" ? <span className={styles.status}>{modelsPanel.startFailed}</span> : null}
      {error ? (
        <span className={styles.status} role="alert">
          {error}
        </span>
      ) : null}
      {blocked ? null : children}
      {installed ? (
        <div className="panel-actions">
          {installed.sourceUrl ? (
            <button type="button" className="btn" onClick={() => onCheckForUpdate(id)}>
              {modelsPanel.checkForUpdate}
            </button>
          ) : null}
          <button type="button" className="btn" onClick={() => onRemove(id)}>
            {modelsPanel.remove}
          </button>
        </div>
      ) : null}
    </li>
  );
}

export function ModelsPanel({
  models,
  activeLens,
  onScore,
  slots,
  notify,
}: {
  models: ModelsState;
  /** The plugin whose model lens is showing, or null. */
  activeLens: PluginId | null;
  onScore: (id: PluginId) => void;
  /** Each plugin's own controls or summary, by plugin id, shown in its card. */
  slots: ReadonlyMap<PluginId, ReactNode>;
  notify: (message: string, tone?: "info" | "warn") => void;
}) {
  const [installing, setInstalling] = useState<{ initial: Inspection | null } | null>(null);

  async function checkForUpdate(id: PluginId) {
    try {
      setInstalling({ initial: await models.checkForUpdate(id) });
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), "info");
    }
  }

  /** Remove a plugin once the author confirms: `run` removes it, installed or damaged. */
  async function remove(name: string, run: () => Promise<void>) {
    if (!window.confirm(modelsPanel.confirmRemove(name))) return;
    try {
      await run();
      notify(modelsPanel.removed(name));
    } catch (error) {
      notify(modelsPanel.removeFailed(name, error instanceof Error ? error.message : String(error)), "warn");
    }
  }

  return (
    <InspectorSection
      id="models"
      title="Models"
      label="Models"
      defaultOpen={false}
      openWhen={activeLens !== null}
      className="models"
    >
      <ul className={styles.list}>
        {BUNDLED_CARDS.map((card) => (
          <PluginCard
            key={card.id}
            card={card}
            models={models}
            scoreActive={activeLens === pluginIdOf(card)}
            onScore={onScore}
            installed={null}
            onCheckForUpdate={() => {}}
            onRemove={() => {}}
          >
            {slots.get(pluginIdOf(card)) ?? null}
          </PluginCard>
        ))}
        {models.installed.map((view) => (
          <PluginCard
            key={view.card.id}
            card={view.card}
            models={models}
            scoreActive={activeLens === pluginIdOf(view.card)}
            onScore={onScore}
            installed={view}
            onCheckForUpdate={(id) => void checkForUpdate(id)}
            onRemove={(id) => void remove(view.card.name, () => models.remove(id))}
          >
            {slots.get(pluginIdOf(view.card)) ?? null}
          </PluginCard>
        ))}
        {models.damaged.map((d) => (
          <li key={d.id} className={styles.card} data-model={d.id} data-status="damaged">
            <strong>{d.id}</strong>
            <span className={styles.status} role="alert">
              {modelsPanel.damaged(d.reason)}
            </span>
            <div className="panel-actions">
              <button type="button" className="btn" onClick={() => void remove(d.id, () => models.removeDamaged(d.id))}>
                {modelsPanel.remove}
              </button>
            </div>
          </li>
        ))}
      </ul>
      <div className="panel-actions">
        <button type="button" className="btn btn-outline" onClick={() => setInstalling({ initial: null })}>
          {modelsPanel.install}
        </button>
      </div>
      <PluginInstallDialog
        open={installing !== null}
        initial={installing?.initial ?? null}
        models={models}
        onClose={() => setInstalling(null)}
        onInstalled={(name, update) => notify(update ? modelsPanel.updated(name) : modelsPanel.installed(name))}
      />
    </InspectorSection>
  );
}
