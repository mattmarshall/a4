"use client";

import { THRESHOLDS, VERDICT_SUMMARY, type Analysis } from "@/lib/analyze";
import { KIND_LABEL, LENSES, type LensId } from "@/lib/lenses";
import { fontSizePt, type PageSpec } from "@/lib/page-spec";

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
  threshold?: number;
  state?: "over" | "warn" | "good";
}) {
  return (
    <div className="bar" data-state={state}>
      <i style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
      {threshold !== undefined ? <b style={{ left: `${threshold * 100}%` }} title="threshold" /> : null}
    </div>
  );
}

function Metric({
  name,
  value,
  shown,
  threshold,
  higherIsBetter,
  note,
}: {
  name: string;
  value: number;
  shown: string;
  threshold?: number;
  higherIsBetter?: boolean;
  note: string;
}) {
  let state: "warn" | "good" | undefined;
  if (threshold !== undefined) {
    const bad = higherIsBetter ? value < threshold : value >= threshold;
    state = bad ? "warn" : "good";
  }
  return (
    <div className="metric">
      <div className="metric-head">
        <span>{name}</span>
        <span className="num">{shown}</span>
      </div>
      <Bar value={value} threshold={threshold} state={state} />
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
            <span className="swatch" style={{ background: "var(--accent)" }} /> Syntax: quotes, braces, colons,
            markup
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

export function MetricsPanel({
  analysis: a,
  spec,
  lens,
  modelLegend,
  compress,
}: {
  analysis: Analysis;
  spec: PageSpec;
  lens: LensId;
  modelLegend?: ModelLegend | null;
  compress: number | null;
}) {
  const t = THRESHOLDS;
  return (
    <>
      <section className="panel-section verdict" aria-live="polite">
        <h2 className="panel-title">Verdict</h2>
        <VerdictChip verdict={a.verdict} />
        <p>{VERDICT_SUMMARY[a.verdict]}</p>
      </section>

      <section className="panel-section capacity">
        <h2 className="panel-title">The page</h2>
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
      </section>

      <section className="panel-section">
        <h2 className="panel-title">Findings</h2>
        <ul className="findings">
          {a.findings.map((f) => (
            <li key={f.id} className="finding" data-s={f.severity}>
              <strong>{f.title}</strong>
              <span>{f.detail}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel-section">
        <h2 className="panel-title">Shape</h2>
        <div className="metric-list">
          <Metric
            name="Syntax overhead"
            value={a.syntax}
            shown={pct(a.syntax)}
            threshold={t.noisySyntax}
            note="Share of ink that is scaffolding: quotes, braces, colons, markup."
          />
          <Metric
            name="Repetition"
            value={a.repetition}
            shown={pct(a.repetition)}
            threshold={t.noisyRepetition}
            note={`Word ink spent restating terms.${a.duplicateLines ? ` ${a.duplicateLines} duplicated lines.` : ""}`}
          />
          <Metric
            name="Narrative share"
            value={a.narrative ?? 0}
            shown={pct(a.narrative)}
            threshold={t.lowNarrative}
            higherIsBetter
            note={`${a.proseLines} sentence lines, ${a.structuredLines} field or fragment lines.`}
          />
          <Metric
            name="Crowding"
            value={a.crowding}
            shown={pct(a.crowding)}
            threshold={t.busyCrowding}
            note="Ink as a share of the cells in used rows."
          />
          <Metric
            name="Indentation"
            value={a.indentation}
            shown={pct(a.indentation)}
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
      </section>

      {a.repeatedTerms.length > 0 ? (
        <section className="panel-section">
          <h2 className="panel-title">Most repeated</h2>
          <div className="terms">
            {a.repeatedTerms.slice(0, 10).map((term) => (
              <span key={term.term} className="term">
                {term.term}
                <em>×{term.count}</em>
              </span>
            ))}
          </div>
        </section>
      ) : null}

      <section className="panel-section">
        <h2 className="panel-title">Lens</h2>
        <LensLegend lens={lens} model={modelLegend} />
      </section>

      <section className="panel-section panel-foot">
        {spec.name} page: {spec.cols} × {spec.rows} cells of {spec.cellW.toFixed(2)} × {spec.cellH.toFixed(2)} mm (
        {fontSizePt(spec).toFixed(1)} pt mono). Token counts are an on-device estimate. Nothing you write leaves this
        browser.
      </section>
    </>
  );
}
