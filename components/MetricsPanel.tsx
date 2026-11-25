"use client";

import {
  DEFAULT_CONFIG,
  KIND_LABEL,
  LENSES,
  type Analysis,
  type Finding,
  type Tone,
  type VerdictId,
} from "@/lib/analysis";
import { fontSizePt, type LensId, type PageSpec } from "@/lib/page";
import { describeFinding, VERDICT_LABEL, VERDICT_SUMMARY, VERDICT_TONE } from "./analysis-copy";
import { InspectorSection } from "./InspectorSection";
import styles from "./MetricsPanel.module.css";

export function pct(x: number | null | undefined, digits = 0): string {
  if (x === null || x === undefined || Number.isNaN(x)) return "–";
  return `${(x * 100).toFixed(digits)}%`;
}

export function num(x: number): string {
  return x.toLocaleString("en-US");
}

function Bar({
  value,
  threshold,
  state,
}: {
  value: number;
  threshold?: number | undefined;
  state?: "over" | "warn" | "good" | undefined;
}) {
  return (
    <div className={styles.bar} data-state={state}>
      <i style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
      {threshold !== undefined ? <b style={{ left: `${threshold * 100}%` }} title="threshold" /> : null}
    </div>
  );
}

/** The bar state for a signal: the same judgment the verdict and findings use. */
const TONE_STATE: Record<Tone, "warn" | "good" | undefined> = { ok: "good", warn: "warn", bad: "warn", na: undefined };

function Metric({
  name,
  value,
  shown,
  threshold,
  tone,
  note,
}: {
  name: string;
  value: number;
  shown: string;
  threshold?: number;
  /** From the analysis signals; without one, the bar shows no judgment. */
  tone?: Tone;
  note: string;
}) {
  const na = tone === "na";
  return (
    <div className={styles.metric} data-na={na ? "" : undefined}>
      <div className={styles.metricHead}>
        <span>{name}</span>
        <span className={styles.num}>{na ? "n/a" : shown}</span>
      </div>
      <Bar value={na ? 0 : value} threshold={na ? undefined : threshold} state={tone ? TONE_STATE[tone] : undefined} />
      <span className={styles.metricNote}>{note}</span>
    </div>
  );
}

export function VerdictChip({ verdict }: { verdict: VerdictId }) {
  return (
    <span className={styles.chip} data-tone={VERDICT_TONE[verdict]}>
      {VERDICT_LABEL[verdict]}
    </span>
  );
}

/** The model lens on the sheet: which plane, and which plugin produced it. */
export interface ModelLegend {
  plane: string;
  plugin: string;
  model?: string;
  /** What 0 and 1 mean for this plane, e.g. "similarity 0.60 → 1.00". */
  scale?: string;
  /** A note on the scale, e.g. where a threshold sits. */
  note?: string;
  /** Who published an installed plugin, e.g. "Unknown publisher (calls itself “Example Labs”)". */
  publisher?: string;
}

export function LensLegend({ lens, model }: { lens: LensId; model?: ModelLegend | null }) {
  if (model) {
    return (
      <div className={styles.legend}>
        <div className={styles.legendRow} style={{ color: "var(--muted)" }}>
          Model lens: per-cell values from a model. The tint is stronger where the value is higher.
        </div>
        <div className={styles.legendRow}>
          <span className="swatch swatch-model-heat" />
          <span>{model.scale ?? "0 → 1"}</span>
        </div>
        {model.note ? (
          <div className={styles.legendRow} style={{ color: "var(--muted)" }}>
            {model.note}
          </div>
        ) : null}
        <div className={styles.legendRow}>
          <span>
            <strong>{model.plane}</strong> · {model.plugin} plugin{model.model ? `, ${model.model}` : ""}
          </span>
        </div>
        {model.publisher ? (
          <div className={styles.legendRow} style={{ color: "var(--muted)" }}>
            {model.publisher}
          </div>
        ) : null}
      </div>
    );
  }
  const info = LENSES.find((l) => l.id === lens);
  return (
    <div className={styles.legend}>
      <div className={styles.legendRow} style={{ color: "var(--muted)" }}>
        {info?.hint}
      </div>
      {lens === "syntax" ? (
        <>
          <div className={styles.legendRow}>
            <span className="swatch" style={{ background: "var(--accent)" }} /> Syntax: quotes, braces, colons, markup
          </div>
          <div className={styles.legendRow}>
            <span className="swatch" style={{ background: "var(--a4-lens-dim)" }} /> Words and numbers
          </div>
        </>
      ) : null}
      {lens === "repetition" ? (
        <div className={styles.legendRow}>
          {[1, 2, 3, 4].map((h) => (
            <span key={h} className={`swatch lens-heat-${h}`} />
          ))}
          <span>repeated 2× → most repeated</span>
        </div>
      ) : null}
      {lens === "structure"
        ? (Object.keys(KIND_LABEL) as (keyof typeof KIND_LABEL)[]).map((k) => (
            <div key={k} className={styles.legendRow}>
              <span className="swatch" style={{ background: `var(--kind-${k})` }} /> {KIND_LABEL[k]}
            </div>
          ))
        : null}
      {lens === "tokens" ? (
        <div className={styles.legendRow}>
          <span className="swatch lens-tok-a" />
          <span className="swatch lens-tok-b" /> Alternating estimated tokens (heuristic)
        </div>
      ) : null}
    </div>
  );
}

/** A page's findings, in the order the assessment gives them. */
export function FindingList({ findings }: { findings: readonly Finding[] }) {
  return (
    <ul className={styles.findings}>
      {findings.map((f) => {
        const { title, detail } = describeFinding(f);
        return (
          <li key={f.id} className={styles.finding} data-s={f.severity}>
            <strong>{title}</strong>
            <span>{detail}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** Warnings and critical findings, shown as a badge even while Findings is collapsed. */
export function findingCount(a: Analysis): number | null {
  const n = a.assessment.findings.filter((f) => f.severity !== "info").length;
  return n > 0 ? n : null;
}

export function MetricsPanel({
  analysis,
  spec,
  compress,
}: {
  analysis: Analysis;
  spec: PageSpec;
  compress: number | null;
}) {
  const t = DEFAULT_CONFIG.verdict;
  const low = DEFAULT_CONFIG.findings.lowNarrative;
  const a = analysis.metrics;
  const v = analysis.assessment;
  return (
    <>
      <InspectorSection id="verdict" title="Verdict" defaultOpen className={styles.verdict}>
        <div className={styles.verdictBody} aria-live="polite">
          <VerdictChip verdict={v.verdict} />
          <p>{VERDICT_SUMMARY[v.verdict]}</p>
        </div>
      </InspectorSection>

      <InspectorSection id="page" title="The page" defaultOpen className={styles.capacity}>
        <div className={styles.capRow}>
          <div className={styles.capHead}>
            <span>Rows used</span>
            <span className={styles.num}>
              {a.rowsUsed} / {a.pageRows}
              {a.overflow > 0 ? `  (+${a.overflow} over)` : ""}
            </span>
          </div>
          <Bar value={a.fill} state={a.overflow > 0 ? "over" : undefined} />
        </div>
        <div className={styles.capRow}>
          <div className={styles.capHead}>
            <span>Tokens (estimate)</span>
            <span className={styles.num}>
              ≈{num(a.tokens)} / {num(a.tokenCeiling)}
            </span>
          </div>
          <Bar value={a.tokens / a.tokenCeiling} state={a.tokens > a.tokenCeiling ? "over" : undefined} />
        </div>
        <div className={styles.stats}>
          <div className={styles.stat}>
            <span className={styles.num}>{num(a.ink)}</span>
            <span className={styles.label}>ink cells</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.num}>{pct(a.coverage)}</span>
            <span className={styles.label}>of {num(a.capacity)}</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.num}>{a.charsPerToken ? a.charsPerToken.toFixed(1) : "–"}</span>
            <span className={styles.label}>chars / token</span>
          </div>
        </div>
        <p className="panel-foot">
          {spec.name} page on {spec.paper.toUpperCase()}: {spec.cols} × {spec.rows} cells of {spec.cellW.toFixed(2)} ×{" "}
          {spec.cellH.toFixed(2)} mm ({fontSizePt(spec).toFixed(1)} pt mono). Token counts are an on-device estimate.
          Nothing you write leaves this browser.
        </p>
      </InspectorSection>

      <InspectorSection id="findings" title="Findings" defaultOpen badge={findingCount(analysis)}>
        <FindingList findings={v.findings} />
      </InspectorSection>

      <InspectorSection id="shape" title="Shape" defaultOpen={false}>
        <div className={styles.metricList}>
          <Metric
            name="Syntax overhead"
            value={a.syntax}
            shown={pct(a.syntax)}
            tone={v.signals.syntax}
            threshold={t.noisySyntax}
            note="Share of ink that is scaffolding: quotes, braces, colons, markup."
          />
          <Metric
            name="Repetition"
            value={a.repetition}
            shown={pct(a.repetition)}
            tone={v.signals.repetition}
            threshold={t.noisyRepetition}
            note={`Word ink spent restating terms.${a.duplicateLines ? ` ${a.duplicateLines} duplicated lines.` : ""}`}
          />
          <Metric
            name="Narrative share"
            value={a.narrative ?? 0}
            shown={pct(a.narrative)}
            tone={v.signals.narrative}
            threshold={low}
            note={`${a.proseLines} sentence lines, ${a.structuredLines} field or fragment lines.`}
          />
          <Metric
            name="Crowding"
            value={a.crowding}
            shown={pct(a.crowding)}
            tone={v.signals.crowding}
            threshold={t.busyCrowding}
            note="Ink as a share of the cells in used rows."
          />
          <Metric
            name="Indentation"
            value={a.indentation}
            shown={pct(a.indentation)}
            tone={v.signals.indentation}
            threshold={t.busyIndentation}
            note={`Leading whitespace${a.maxIndent ? `; deepest indent ${a.maxIndent} columns` : ""}.`}
          />
          <Metric
            name="Compressibility"
            value={compress ?? 0}
            shown={compress === null ? "–" : pct(compress)}
            note="Deflated size ÷ raw size. Lower means more redundant text."
          />
        </div>
      </InspectorSection>

      {a.repeatedTerms.length > 0 ? (
        <InspectorSection id="repeated" title="Most repeated" defaultOpen={false}>
          <div className={styles.terms}>
            {a.repeatedTerms.slice(0, 10).map((term) => (
              <span key={term.term} className={styles.term}>
                {term.term}
                <em>×{term.count}</em>
              </span>
            ))}
          </div>
        </InspectorSection>
      ) : null}
    </>
  );
}
