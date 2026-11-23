"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { analyze, compressibility } from "@/lib/analyze";
import { isLensId, LENSES, type LensId } from "@/lib/lenses";
import {
  DEFAULT_PRESET,
  isPresetId,
  PRESET_ORDER,
  PRESETS,
  PX_PER_MM_ACTUAL,
  type PresetId,
} from "@/lib/page-spec";
import { SAMPLE_PAIRS, TEMPLATES, WELCOME } from "@/lib/samples";
import { KEYS, readKey, writeKey } from "@/lib/storage";
import { slugFromText } from "@/lib/text";
import { ComparePanel } from "./ComparePanel";
import { MetricsPanel } from "./MetricsPanel";
import { Sheet } from "./Sheet";

type Mode = "single" | "compare";
type PageKey = "a" | "b";
type Zoom = { kind: "fit" } | { kind: "fixed"; mm: number };

const ZOOM_STEPS = [0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
const MIN_MM = 1.2;

function useCompressibility(text: string): number | null {
  const [value, setValue] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      compressibility(text)
        .then((v) => {
          if (!cancelled) setValue(v);
        })
        .catch(() => {
          if (!cancelled) setValue(null);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [text]);
  return value;
}

function useOutsideClose(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);
  return ref;
}

export function Workbench() {
  const [ready, setReady] = useState(false);
  const [textA, setTextA] = useState(WELCOME);
  const [textB, setTextB] = useState("");
  const [presetId, setPresetId] = useState<PresetId>(DEFAULT_PRESET);
  const [lens, setLens] = useState<LensId>("ink");
  const [showGrid, setShowGrid] = useState(false);
  const [mode, setMode] = useState<Mode>("single");
  const [active, setActive] = useState<PageKey>("a");
  const [zoom, setZoom] = useState<Zoom>({ kind: "fit" });
  const [deskWidth, setDeskWidth] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const deskRef = useRef<HTMLDivElement>(null);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const menuRef = useOutsideClose(menuOpen, closeMenu);

  const spec = PRESETS[presetId];

  // Restore saved state after mount (the page is prerendered with defaults).
  useEffect(() => {
    const a = readKey(KEYS.textA);
    const b = readKey(KEYS.textB);
    const p = readKey(KEYS.preset);
    const l = readKey(KEYS.lens);
    const g = readKey(KEYS.grid);
    const m = readKey(KEYS.mode);
    if (a !== null) setTextA(a);
    if (b !== null) setTextB(b);
    if (isPresetId(p)) setPresetId(p);
    if (isLensId(l)) setLens(l);
    if (g !== null) setShowGrid(g === "1");
    if (m === "single" || m === "compare") setMode(m);
    setReady(true);
  }, []);

  // Autosave (text debounced; settings immediately).
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => {
      writeKey(KEYS.textA, textA);
      writeKey(KEYS.textB, textB);
    }, 300);
    return () => clearTimeout(t);
  }, [ready, textA, textB]);

  useEffect(() => {
    if (!ready) return;
    writeKey(KEYS.preset, presetId);
    writeKey(KEYS.lens, lens);
    writeKey(KEYS.grid, showGrid ? "1" : "0");
    writeKey(KEYS.mode, mode);
  }, [ready, presetId, lens, showGrid, mode]);

  // Track available desk width for fit-to-width zoom.
  useEffect(() => {
    const el = deskRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setDeskWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pages = mode === "compare" ? 2 : 1;
  const fitMm = useMemo(() => {
    if (!deskWidth) return PX_PER_MM_ACTUAL;
    const gap = 28 * (pages - 1);
    const fit = (deskWidth - gap) / (210 * pages);
    return Math.max(MIN_MM, Math.min(PX_PER_MM_ACTUAL, fit));
  }, [deskWidth, pages]);
  const mm = zoom.kind === "fit" ? fitMm : zoom.mm;
  const zoomPct = Math.round((mm / PX_PER_MM_ACTUAL) * 100);

  function stepZoom(dir: 1 | -1) {
    const current = mm / PX_PER_MM_ACTUAL;
    const next =
      dir > 0
        ? (ZOOM_STEPS.find((s) => s > current + 0.001) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1])
        : ([...ZOOM_STEPS].reverse().find((s) => s < current - 0.001) ?? ZOOM_STEPS[0]);
    setZoom({ kind: "fixed", mm: next * PX_PER_MM_ACTUAL });
  }

  const analysisA = useMemo(() => analyze(textA, spec), [textA, spec]);
  const analysisB = useMemo(() => analyze(textB, spec), [textB, spec]);
  const compressA = useCompressibility(textA);
  const compressB = useCompressibility(textB);

  const target: PageKey = mode === "compare" ? active : "a";
  const targetText = target === "a" ? textA : textB;
  const setTarget = target === "a" ? setTextA : setTextB;

  const notify = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 1800);
  }, []);

  function confirmReplace(page: PageKey, current: string, next: string, what: string): boolean {
    if (current.trim() === "" || current === next) return true;
    return window.confirm(`Replace the text on page ${page.toUpperCase()} with ${what}?`);
  }

  function loadTemplate(id: string) {
    const t = TEMPLATES.find((x) => x.id === id);
    setMenuOpen(false);
    if (!t || !confirmReplace(target, targetText, t.text, `the ${t.name} template`)) return;
    setTarget(t.text);
  }

  function loadPair(id: string) {
    const p = SAMPLE_PAIRS.find((x) => x.id === id);
    setMenuOpen(false);
    if (!p) return;
    const dirty = (textA.trim() !== "" && textA !== p.a && textA !== WELCOME) || (textB.trim() !== "" && textB !== p.b);
    if (dirty && !window.confirm(`Replace pages A and B with the “${p.name}” sample?`)) return;
    setTextA(p.a);
    setTextB(p.b);
    setMode("compare");
    setZoom({ kind: "fit" });
  }

  function loadWelcome() {
    setMenuOpen(false);
    if (!confirmReplace(target, targetText, WELCOME, "the welcome page")) return;
    setTarget(WELCOME);
  }

  function clearPage() {
    setMenuOpen(false);
    if (targetText === "") return;
    if (!window.confirm(`Clear page ${target.toUpperCase()}?`)) return;
    setTarget("");
    document.getElementById(`sheet-${target}`)?.focus();
  }

  async function copyText() {
    try {
      await navigator.clipboard.writeText(targetText);
      notify(`Copied page ${target.toUpperCase()} (${targetText.length.toLocaleString("en-US")} characters)`);
    } catch {
      notify("Copy failed: clipboard access was blocked");
    }
  }

  function downloadText() {
    const blob = new Blob([targetText], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slugFromText(targetText)}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function setModeAndFit(next: Mode) {
    setMode(next);
    setZoom({ kind: "fit" });
    if (next === "single") setActive("a");
  }

  return (
    <div className="app">
      <header className="topbar">
        <Link href="/" className="brand" aria-label="A4 home">
          <span className="brand-mark">A4</span>
          <span className="brand-tag">one page of context</span>
        </Link>

        <div className="toolbar" role="toolbar" aria-label="Page controls">
          <div className="tool-group" title={spec.blurb}>
            <span className="tool-label">Page</span>
            <select
              className="select"
              aria-label="Page preset"
              value={presetId}
              onChange={(e) => setPresetId(e.target.value as PresetId)}
            >
              {PRESET_ORDER.map((id) => (
                <option key={id} value={id}>
                  {PRESETS[id].name} · {PRESETS[id].cols}×{PRESETS[id].rows}
                </option>
              ))}
            </select>
          </div>

          <div className="tool-group">
            <span className="tool-label">Lens</span>
            <div className="seg" role="group" aria-label="Lens">
              {LENSES.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  aria-pressed={lens === l.id}
                  title={l.hint}
                  onClick={() => setLens(l.id)}
                >
                  {l.name}
                </button>
              ))}
            </div>
          </div>

          <div className="tool-group">
            <button
              type="button"
              className="btn"
              aria-pressed={showGrid}
              onClick={() => setShowGrid((g) => !g)}
              title="Show the cell grid"
            >
              Grid
            </button>
            <div className="seg" role="group" aria-label="View">
              <button type="button" aria-pressed={mode === "single"} onClick={() => setModeAndFit("single")}>
                Single
              </button>
              <button type="button" aria-pressed={mode === "compare"} onClick={() => setModeAndFit("compare")}>
                Compare
              </button>
            </div>
          </div>

          <div className="tool-group" aria-label="Zoom">
            <button type="button" className="btn" onClick={() => stepZoom(-1)} aria-label="Zoom out">
              −
            </button>
            <span className="zoom-value" aria-live="polite">
              {zoomPct}%
            </span>
            <button type="button" className="btn" onClick={() => stepZoom(1)} aria-label="Zoom in">
              +
            </button>
            <button
              type="button"
              className="btn"
              aria-pressed={zoom.kind === "fit"}
              onClick={() => setZoom({ kind: "fit" })}
            >
              Fit
            </button>
            <button
              type="button"
              className="btn"
              aria-pressed={zoom.kind === "fixed" && Math.abs(zoom.mm - PX_PER_MM_ACTUAL) < 0.01}
              onClick={() => setZoom({ kind: "fixed", mm: PX_PER_MM_ACTUAL })}
              title="Actual size: 1 mm on screen per mm of paper (96 dpi)"
            >
              1:1
            </button>
          </div>

          <span className="spacer" />

          <div className="menu" ref={menuRef}>
            <button
              type="button"
              className="btn btn-outline"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((o) => !o)}
            >
              Templates ▾
            </button>
            {menuOpen ? (
              <div className="menu-list" role="menu">
                <div className="menu-heading">Narrative templates</div>
                {TEMPLATES.map((t) => (
                  <button key={t.id} type="button" role="menuitem" className="menu-item" onClick={() => loadTemplate(t.id)}>
                    <strong>{t.name}</strong>
                    <span>{t.blurb}</span>
                  </button>
                ))}
                <div className="menu-sep" />
                <div className="menu-heading">Worked samples</div>
                {SAMPLE_PAIRS.map((p) => (
                  <button key={p.id} type="button" role="menuitem" className="menu-item" onClick={() => loadPair(p.id)}>
                    <strong>{p.name}</strong>
                    <span>{p.blurb}</span>
                  </button>
                ))}
                <button type="button" role="menuitem" className="menu-item" onClick={loadWelcome}>
                  <strong>Welcome page</strong>
                  <span>What A4 is, written as one page</span>
                </button>
                <div className="menu-sep" />
                <button type="button" role="menuitem" className="menu-item" onClick={clearPage}>
                  <strong>Clear page {target.toUpperCase()}</strong>
                  <span>Start from a blank sheet</span>
                </button>
              </div>
            ) : null}
          </div>
          <button type="button" className="btn btn-outline" onClick={copyText}>
            Copy
          </button>
          <button type="button" className="btn btn-outline" onClick={downloadText}>
            Download
          </button>
          <button type="button" className="btn btn-outline" onClick={() => window.print()}>
            Print
          </button>
          <Link href="/why" className="btn">
            Why A4?
          </Link>
        </div>
      </header>

      <div className="workspace">
        <main className="desk" ref={deskRef}>
          <div className="sheets">
            <div className="sheet-col">
              {mode === "compare" ? (
                <div className="sheet-caption">
                  <b>A</b> {analysisA.verdict} · ≈{analysisA.tokens.toLocaleString("en-US")} tokens
                  {active === "a" ? " · editing" : ""}
                </div>
              ) : null}
              <Sheet
                id="sheet-a"
                label="Page A"
                text={textA}
                onChange={setTextA}
                onFocus={() => setActive("a")}
                spec={spec}
                lens={lens}
                showGrid={showGrid}
                mm={mm}
                analysis={analysisA}
                hidden={!ready}
              />
            </div>
            {mode === "compare" ? (
              <div className="sheet-col">
                <div className="sheet-caption">
                  <b>B</b> {analysisB.verdict} · ≈{analysisB.tokens.toLocaleString("en-US")} tokens
                  {active === "b" ? " · editing" : ""}
                </div>
                <Sheet
                  id="sheet-b"
                  label="Page B"
                  text={textB}
                  onChange={setTextB}
                  onFocus={() => setActive("b")}
                  spec={spec}
                  lens={lens}
                  showGrid={showGrid}
                  mm={mm}
                  analysis={analysisB}
                  hidden={!ready}
                />
              </div>
            ) : null}
          </div>
        </main>

        <aside className="sidebar" aria-label="Page analysis">
          {mode === "compare" ? (
            <ComparePanel
              a={analysisA}
              b={analysisB}
              compressA={compressA}
              compressB={compressB}
              lens={lens}
              onSwap={() => {
                setTextA(textB);
                setTextB(textA);
              }}
              onCopyAToB={() => {
                if (!confirmReplace("b", textB, textA, "a copy of page A")) return;
                setTextB(textA);
              }}
            />
          ) : (
            <MetricsPanel analysis={analysisA} spec={spec} lens={lens} compress={compressA} />
          )}
        </aside>
      </div>

      {toast ? (
        <div className="toast" role="status">
          {toast}
        </div>
      ) : null}
    </div>
  );
}
