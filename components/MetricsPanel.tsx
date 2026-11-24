"use client";

import { THRESHOLDS, VERDICT_SUMMARY, type Analysis, type Tone } from "@/lib/analyze";
import { KIND_LABEL, LENSES, type LensId } from "@/lib/lenses";
import { InspectorSection } from "./InspectorSection";
import { fontSizePt, type PageSpec } from "@/lib/page-spec";

export function pct(x: number | null | undefined, digits = 0): string {
  if (x === null || x === undefined || Number.isNaN(x)) return "–";
  return `${(x * 100).toFixed(digits)}%`;
}

export function num(x: number): string {
  return x.toLocaleString("en-US");
}

function Bar({ value, threshold, state }: { value: number; threshold?: number; state?: "over" | "warn" | "good" }) {
  return (
    <div className="bar" data-state={state}>
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
    <div className="metric" data-na={na ? "" : undefined}>
      <div className="metric-head">
        <span>{name}</span>
        <span className="num">{na ? "n/a" : shown}</span>
      </div>
      <Bar value={na ? 0 : value} threshold={na ? undefined : threshold} state={tone ? TONE_STATE[tone] : undefined} />
      <span className="metric-note">{note}</span>
    </div>
  );
}

export function VerdictChip({ verdict }: { verdict: Analysis["verdict"] }) {
  return (
    <span className="verdict-chip" data-v={verdict}>
      {verdict}
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
}

export function LensLegend({ lens, model }: { lens: LensId; model?: ModelLegend | null }) {
  if (model) {
    return (
      <div className="legend">
        <div className="legend-row" style={{ color: "var(--muted)" }}>
          Model lens: per-cell values from a model. The tint is stronger where the value is higher.
        </div>
        <div className="legend-row">
          <span className="swatch swatch-model-heat" />
          <span>{model.scale ?? "0 → 1"}</span>
        </div>
        {model.note ? (
          <div className="legend-row" style={{ color: "var(--muted)" }}>
            {model.note}
          </div>
        ) : null}
        <div className="legend-row">
          <span>
            <strong>{model.plane}</strong> · {model.plugin} plugin{model.model ? `, ${model.model}` : ""}
          </span>
        </div>
      </div>
    );
  }
  const info = LENSES.find((l) => l.id === lens);
  return (
    <div className="legend">
      <div className="legend-row" style={{ color: "var(--muted)" }}>
        {info?.hint}
      </div>
      {lens === "syntax" ? (
        <>
          <div className="legend-row">
            <span className="swatch" style={{ background: "var(--accent)" }} /> Syntax: quotes, braces, colons, markup
          </div>
          <div className="legend-row">
            <span className="swatch" style={{ background: "#8f8a80" }} /> Words and numbers
          </div>
        </>
      ) : null}
      {lens === "repetition" ? (
        <div className="legend-row">
          {[1, 2, 3, 4].map((h) => (
            <span key={h} className={`swatch lens-heat-${h}`} />
          ))}
          <span>repeated 2× → most repeated</span>
        </div>
      ) : null}
      {lens === "structure"
        ? (Object.keys(KIND_LABEL) as (keyof typeof KIND_LABEL)[]).map((k) => (
            <div key={k} className="legend-row">
              <span className="swatch" style={{ background: `var(--kind-${k})` }} /> {KIND_LABEL[k]}
            </div>
          ))
        : null}
      {lens === "tokens" ? (
        <div className="legend-row">
          <span className="swatch lens-tok-a" />
          <span className="swatch lens-tok-b" /> Alternating estimated tokens (heuristic)
        </div>
      ) : null}
    </div>
  );
}

/** Warnings and critical findings, shown as a badge even while Findings is collapsed. */
export function findingCount(a: Analysis): number | null {
  const n = a.findings.filter((f) => f.severity !== "info").length;
  return n > 0 ? n : null;
}

export function MetricsPanel({
  analysis: a,
  spec,
  compress,
}: {
  analysis: Analysis;
  spec: PageSpec;
  compress: number | null;
}) {
  const t = THRESHOLDS;
  return (
    <>
      <InspectorSection id="verdict" title="Verdict" defaultOpen className="verdict">
        <div className="verdict-body" aria-live="polite">
          <VerdictChip verdict={a.verdict} />
          <p>{VERDICT_SUMMARY[a.verdict]}</p>
        </div>
      </InspectorSection>

      <InspectorSection id="page" title="The page" defaultOpen className="capacity">
        <div className="cap-row">
          <div className="cap-head">
            <span>Rows used</span>
            <span className="num">
              {a.rowsUsed} / {a.pageRows}
              {a.overflow > 0 ? `  (+${a.overflow} over)` : ""}
            </span>
          </div>
          <Bar value={a.fill} state={a.overflow > 0 ? "over" : undefined} />
        </div>
        <div className="cap-row">
          <div className="cap-head">
            <span>Tokens (estimate)</span>
            <span className="num">
              ≈{num(a.tokens)} / {num(a.tokenCeiling)}
            </span>
          </div>
          <Bar value={a.tokens / a.tokenCeiling} state={a.tokens > a.tokenCeiling ? "over" : undefined} />
        </div>
        <div className="stats">
          <div className="stat">
            <span className="num">{num(a.ink)}</span>
            <span className="lbl">ink cells</span>
          </div>
          <div className="stat">
            <span className="num">{pct(a.coverage)}</span>
            <span className="lbl">of {num(a.capacity)}</span>
          </div>
          <div className="stat">
            <span className="num">{a.charsPerToken ? a.charsPerToken.toFixed(1) : "–"}</span>
            <span className="lbl">chars / token</span>
          </div>
        </div>
        <p className="panel-foot">
          {spec.name} page: {spec.cols} × {spec.rows} cells of {spec.cellW.toFixed(2)} × {spec.cellH.toFixed(2)} mm (
          {fontSizePt(spec).toFixed(1)} pt mono). Token counts are an on-device estimate. Nothing you write leaves this
          browser.
        </p>
      </InspectorSection>

      <InspectorSection id="findings" title="Findings" defaultOpen badge={findingCount(a)}>
        <ul className="findings">
          {a.findings.map((f) => (
            <li key={f.id} className="finding" data-s={f.severity}>
              <strong>{f.title}</strong>
              <span>{f.detail}</span>
            </li>
          ))}
        </ul>
      </InspectorSection>

      <InspectorSection id="shape" title="Shape" defaultOpen={false}>
        <div className="metric-list">
          <Metric
            name="Syntax overhead"
            value={a.syntax}
            shown={pct(a.syntax)}
            tone={a.signals.syntax}
            threshold={t.noisySyntax}
            note="Share of ink that is scaffolding: quotes, braces, colons, markup."
          />
          <Metric
            name="Repetition"
            value={a.repetition}
            shown={pct(a.repetition)}
            tone={a.signals.repetition}
            threshold={t.noisyRepetition}
            note={`Word ink spent restating terms.${a.duplicateLines ? ` ${a.duplicateLines} duplicated lines.` : ""}`}
          />
          <Metric
            name="Narrative share"
            value={a.narrative ?? 0}
            shown={pct(a.narrative)}
            tone={a.signals.narrative}
            threshold={t.lowNarrative}
            note={`${a.proseLines} sentence lines, ${a.structuredLines} field or fragment lines.`}
          />
          <Metric
            name="Crowding"
            value={a.crowding}
            shown={pct(a.crowding)}
            tone={a.signals.crowding}
            threshold={t.busyCrowding}
            note="Ink as a share of the cells in used rows."
          />
          <Metric
            name="Indentation"
            value={a.indentation}
            shown={pct(a.indentation)}
            tone={a.signals.indentation}
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
          <div className="terms">
            {a.repeatedTerms.slice(0, 10).map((term) => (
              <span key={term.term} className="term">
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
