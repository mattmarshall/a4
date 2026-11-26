"use client";

import type { Analysis } from "@/lib/analysis";
import { VERDICT_SUMMARY } from "./analysis-copy";
import styles from "./ComparePanel.module.css";
import { InspectorSection } from "./InspectorSection";
import { FindingList, findingCount, num, pct, VerdictChip } from "./MetricsPanel";

interface Row {
  name: string;
  a: number | null;
  b: number | null;
  format: (x: number | null) => string;
  /** "lower" or "higher" is better; undefined means no direction. */
  better?: "lower" | "higher";
  /** Format for the B − A delta. */
  delta: (d: number) => string;
}

function signed(s: string, d: number): string {
  return d > 0 ? `+${s}` : s;
}

const pts = (d: number) => signed(`${(d * 100).toFixed(0)} pts`, d);
const count = (d: number) => signed(num(d), d);

export function ComparePanel({
  a,
  b,
  compressA,
  compressB,
  actions,
}: {
  a: Analysis;
  b: Analysis;
  compressA: number | null;
  compressB: number | null;
  /** Swap A and B, and Duplicate A into B; null while they can't change the pages (a share link is open). */
  actions: { readonly swap: () => void; readonly copyAToB: () => void } | null;
}) {
  const rows: Row[] = [
    {
      name: "Rows used",
      a: a.metrics.rowsUsed,
      b: b.metrics.rowsUsed,
      format: (x) => (x === null ? "–" : num(x)),
      better: "lower",
      delta: count,
    },
    {
      name: "Overflow",
      a: a.metrics.overflow,
      b: b.metrics.overflow,
      format: (x) => (x === null ? "–" : num(x)),
      better: "lower",
      delta: count,
    },
    {
      name: "Tokens ≈",
      a: a.metrics.tokens,
      b: b.metrics.tokens,
      format: (x) => (x === null ? "–" : num(x)),
      better: "lower",
      delta: count,
    },
    { name: "Syntax", a: a.metrics.syntax, b: b.metrics.syntax, format: (x) => pct(x), better: "lower", delta: pts },
    {
      name: "Repetition",
      a: a.metrics.repetition,
      b: b.metrics.repetition,
      format: (x) => pct(x),
      better: "lower",
      delta: pts,
    },
    {
      name: "Narrative",
      a: a.metrics.narrative,
      b: b.metrics.narrative,
      format: (x) => pct(x),
      better: "higher",
      delta: pts,
    },
    { name: "Crowding", a: a.metrics.crowding, b: b.metrics.crowding, format: (x) => pct(x), delta: pts },
    {
      name: "Indentation",
      a: a.metrics.indentation,
      b: b.metrics.indentation,
      format: (x) => pct(x),
      better: "lower",
      delta: pts,
    },
    {
      name: "Duplicate lines",
      a: a.metrics.duplicateLines,
      b: b.metrics.duplicateLines,
      format: (x) => (x === null ? "–" : num(x)),
      better: "lower",
      delta: count,
    },
    { name: "Compressibility", a: compressA, b: compressB, format: (x) => pct(x), delta: pts },
  ];

  function betterSide(r: Row): "a" | "b" | null {
    if (!r.better || r.a === null || r.b === null || r.a === r.b) return null;
    const bWins = r.better === "lower" ? r.b < r.a : r.b > r.a;
    return bWins ? "b" : "a";
  }

  return (
    <>
      <InspectorSection id="compare-verdicts" title="Verdicts" defaultOpen>
        <div className={styles.verdicts}>
          <div>
            <span>
              Page <b>A</b>
            </span>
            <VerdictChip verdict={a.assessment.verdict} />
            <span>{VERDICT_SUMMARY[a.assessment.verdict]}</span>
          </div>
          <div>
            <span>
              Page <b>B</b>
            </span>
            <VerdictChip verdict={b.assessment.verdict} />
            <span>{VERDICT_SUMMARY[b.assessment.verdict]}</span>
          </div>
        </div>
      </InspectorSection>

      <InspectorSection id="compare-metrics" title="A vs B" defaultOpen>
        <table className={styles.table}>
          <thead className="eyebrow">
            <tr>
              <th>Metric</th>
              <th>A</th>
              <th>B</th>
              <th>B − A</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const win = betterSide(r);
              const d = r.a !== null && r.b !== null ? r.b - r.a : null;
              return (
                <tr key={r.name}>
                  <td>{r.name}</td>
                  <td data-better={win === "a"}>{r.format(r.a)}</td>
                  <td data-better={win === "b"}>{r.format(r.b)}</td>
                  <td className={styles.delta}>{d === null || d === 0 ? "–" : r.delta(d)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {actions ? (
          <div className="panel-actions">
            <button type="button" className="btn btn-outline" onClick={actions.swap}>
              ⇄ Swap A and B
            </button>
            <button type="button" className="btn btn-outline" onClick={actions.copyAToB}>
              Duplicate A into B
            </button>
          </div>
        ) : null}
        <p className="panel-foot">
          Green marks the better value for metrics with a direction. A common workflow: paste the raw data into A, write
          the narrative in B, and keep B once it is lower on syntax and tokens without losing facts. Pick either page
          from the menu above its sheet.
        </p>
      </InspectorSection>

      <InspectorSection id="compare-findings" title="Findings for B" defaultOpen badge={findingCount(b)}>
        <FindingList findings={b.assessment.findings} />
      </InspectorSection>
    </>
  );
}
