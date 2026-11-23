"use client";

import { VERDICT_SUMMARY, type Analysis } from "@/lib/analyze";
import type { LensId } from "@/lib/lenses";
import { LensLegend, num, pct, VerdictChip } from "./MetricsPanel";

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
  lens,
  onSwap,
  onCopyAToB,
}: {
  a: Analysis;
  b: Analysis;
  compressA: number | null;
  compressB: number | null;
  lens: LensId;
  onSwap: () => void;
  onCopyAToB: () => void;
}) {
  const rows: Row[] = [
    { name: "Rows used", a: a.rowsUsed, b: b.rowsUsed, format: (x) => (x === null ? "–" : num(x)), better: "lower", delta: count },
    { name: "Overflow", a: a.overflow, b: b.overflow, format: (x) => (x === null ? "–" : num(x)), better: "lower", delta: count },
    { name: "Tokens ≈", a: a.tokens, b: b.tokens, format: (x) => (x === null ? "–" : num(x)), better: "lower", delta: count },
    { name: "Syntax", a: a.syntax, b: b.syntax, format: (x) => pct(x), better: "lower", delta: pts },
    { name: "Repetition", a: a.repetition, b: b.repetition, format: (x) => pct(x), better: "lower", delta: pts },
    { name: "Narrative", a: a.narrative, b: b.narrative, format: (x) => pct(x), better: "higher", delta: pts },
    { name: "Crowding", a: a.crowding, b: b.crowding, format: (x) => pct(x), delta: pts },
    { name: "Indentation", a: a.indentation, b: b.indentation, format: (x) => pct(x), better: "lower", delta: pts },
    { name: "Duplicate lines", a: a.duplicateLines, b: b.duplicateLines, format: (x) => (x === null ? "–" : num(x)), better: "lower", delta: count },
    { name: "Compressibility", a: compressA, b: compressB, format: (x) => pct(x), delta: pts },
  ];

  function betterSide(r: Row): "a" | "b" | null {
    if (!r.better || r.a === null || r.b === null || r.a === r.b) return null;
    const bWins = r.better === "lower" ? r.b < r.a : r.b > r.a;
    return bWins ? "b" : "a";
  }

  return (
    <>
      <section className="panel-section">
        <h2 className="panel-title">Verdicts</h2>
        <div className="compare-verdicts">
          <div>
            <span>
              Page <b>A</b>
            </span>
            <VerdictChip verdict={a.verdict} />
            <span>{VERDICT_SUMMARY[a.verdict]}</span>
          </div>
          <div>
            <span>
              Page <b>B</b>
            </span>
            <VerdictChip verdict={b.verdict} />
            <span>{VERDICT_SUMMARY[b.verdict]}</span>
          </div>
        </div>
      </section>

      <section className="panel-section">
        <h2 className="panel-title">A vs B</h2>
        <table className="compare-table">
          <thead>
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
                  <td className="delta">{d === null || d === 0 ? "–" : r.delta(d)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="panel-actions">
          <button type="button" className="btn btn-outline" onClick={onSwap}>
            ⇄ Swap A and B
          </button>
          <button type="button" className="btn btn-outline" onClick={onCopyAToB}>
            Duplicate A into B
          </button>
        </div>
      </section>

      <section className="panel-section">
        <h2 className="panel-title">Findings for B</h2>
        <ul className="findings">
          {b.findings.map((f) => (
            <li key={f.id} className="finding" data-s={f.severity}>
              <strong>{f.title}</strong>
              <span>{f.detail}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel-section">
        <h2 className="panel-title">Lens</h2>
        <LensLegend lens={lens} />
      </section>

      <section className="panel-section panel-foot">
        Green marks the better value for metrics with a direction. A common workflow: paste the raw data into A, write
        the narrative in B, and keep B once it is lower on syntax and tokens without losing facts. Pick either page
        from the menu above its sheet.
      </section>
    </>
  );
}
