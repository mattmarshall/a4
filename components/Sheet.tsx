"use client";

import { memo, useMemo, type ClipboardEvent, type CSSProperties, type KeyboardEvent } from "react";
import type { Analysis } from "@/lib/analyze";
import { segmentsFor, type LensId } from "@/lib/lenses";
import type { PageSpec } from "@/lib/page-spec";
import { normalizeText, TAB_SPACES } from "@/lib/text";

export interface SheetProps {
  id: string;
  text: string;
  onChange: (text: string) => void;
  onFocus?: () => void;
  spec: PageSpec;
  lens: LensId;
  showGrid: boolean;
  /** CSS pixels per millimeter. */
  mm: number;
  analysis: Analysis;
  label: string;
  hidden?: boolean;
}

/** Insert text at the caret, keeping the browser's native undo stack. */
function insertAtCaret(el: HTMLTextAreaElement, insert: string) {
  el.focus();
  // execCommand is deprecated but is still the only way to keep native undo.
  const ok = typeof document.execCommand === "function" && document.execCommand("insertText", false, insert);
  if (!ok) {
    el.setRangeText(insert, el.selectionStart, el.selectionEnd, "end");
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

const Backdrop = memo(function Backdrop({
  text,
  lens,
  analysis,
}: {
  text: string;
  lens: LensId;
  analysis: Analysis;
}) {
  const segments = useMemo(() => segmentsFor(lens, text, analysis), [lens, text, analysis]);
  return (
    <div className="ink-layer backdrop" aria-hidden="true">
      {segments.map((s, i) =>
        s.cls ? (
          <span key={i} className={s.cls}>
            {s.text}
          </span>
        ) : (
          s.text
        ),
      )}
      {/* Keep a trailing newline's empty row measurable. */}
      {text.endsWith("\n") ? "​" : null}
    </div>
  );
});

export function Sheet({
  id,
  text,
  onChange,
  onFocus,
  spec,
  lens,
  showGrid,
  mm,
  analysis,
  label,
  hidden,
}: SheetProps) {
  const totalRows = Math.max(spec.rows, analysis.rowsTotal);
  const overflowRows = Math.max(0, analysis.rowsTotal - spec.rows);
  const bottomMm = spec.marginY + totalRows * spec.cellH;
  const wrapHeightMm = Math.max(297, bottomMm + (overflowRows > 0 ? 10 : 0));

  const vars = {
    "--mm": `${mm}px`,
    "--cw": spec.cellW,
    "--ch": spec.cellH,
    "--cols": spec.cols,
    "--rows": spec.rows,
    "--mx": spec.marginX,
    "--my": spec.marginY,
    height: `${wrapHeightMm * mm}px`,
  } as CSSProperties;

  const rowTop = (i: number) => `calc(${i} * var(--ch) * var(--mm))`;

  const ticks = useMemo(() => {
    const out: { c: number; major: boolean; label: boolean }[] = [];
    for (let c = 5; c <= spec.cols; c += 5) out.push({ c, major: c % 10 === 0, label: c % 10 === 0 });
    return out;
  }, [spec.cols]);

  const rowLabels = useMemo(() => {
    const out: number[] = [1];
    for (let r = 5; r <= spec.rows; r += 5) out.push(r);
    return out;
  }, [spec.rows]);

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Tab" && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      insertAtCaret(e.currentTarget, TAB_SPACES);
    }
  }

  function handlePaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const raw = e.clipboardData.getData("text/plain");
    if (!raw) return;
    const clean = normalizeText(raw);
    if (clean === raw) return;
    e.preventDefault();
    insertAtCaret(e.currentTarget, clean);
  }

  return (
    <div className={`sheet-wrap${hidden ? " sheet-hidden" : ""}`} style={vars}>
      <div className="sheet">
        <div className="paper" />

        <div className="ruler-top" aria-hidden="true">
          {ticks.map(({ c, major, label: showLabel }) => (
            <span key={c}>
              <i
                className="ruler-tick"
                data-major={major}
                style={{ left: `calc(${c - 0.5} * var(--cw) * var(--mm))` }}
              />
              {showLabel ? (
                <span className="ruler-label" style={{ left: `calc(${c - 0.5} * var(--cw) * var(--mm))` }}>
                  {c}
                </span>
              ) : null}
            </span>
          ))}
        </div>

        <div className="row-numbers" aria-hidden="true">
          {rowLabels.map((r) => (
            <span key={r} className="row-number" style={{ top: rowTop(r - 1) }}>
              {r}
            </span>
          ))}
        </div>

        <div className="grid-area">
          {showGrid ? <div className="cell-grid" /> : null}

          {lens === "structure"
            ? analysis.rows.map((row, i) => {
                const kind = analysis.lineKinds[row.line];
                if (!kind || kind === "blank") return null;
                return <div key={i} className="row-band" data-k={kind} style={{ top: rowTop(i) }} />;
              })
            : null}

          {overflowRows > 0 ? (
            <>
              <div
                className="overflow-zone"
                style={{ top: rowTop(spec.rows), height: `calc(${overflowRows} * var(--ch) * var(--mm))` }}
              />
              <div className="page-end" style={{ top: rowTop(spec.rows) }} />
              <div className="overflow-label" style={{ top: rowTop(spec.rows) }}>
                {analysis.overflow > 0
                  ? `▼ ${analysis.overflow} ${analysis.overflow === 1 ? "row" : "rows"} over the page`
                  : "▼ blank rows past the page"}
              </div>
            </>
          ) : null}

          <Backdrop text={text} lens={lens} analysis={analysis} />

          <textarea
            id={id}
            className="ink-layer editor"
            aria-label={`${label}: A4 page, ${spec.cols} columns by ${spec.rows} rows`}
            value={text}
            onChange={(e) => {
              const v = e.target.value;
              onChange(/[\t\r]/.test(v) ? normalizeText(v) : v);
            }}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onFocus={onFocus}
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            autoComplete="off"
            wrap="soft"
            placeholder="Write the context you would hand an agent…"
            style={{ height: `calc(${totalRows} * var(--ch) * var(--mm))` }}
          />
        </div>

        <div className="gauge" aria-hidden="true">
          {analysis.rows.map((row, i) =>
            row.ink > 0 ? (
              <i
                key={i}
                className="gauge-bar"
                data-over={i >= spec.rows}
                data-hot={row.ink / spec.cols >= 0.85}
                style={{ top: rowTop(i), width: `${Math.min(1, row.ink / spec.cols) * 100}%` }}
              />
            ) : null,
          )}
        </div>
      </div>
    </div>
  );
}
