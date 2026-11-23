"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { analyze, compressibility } from "@/lib/analyze";
import type { SaveStatus } from "@/lib/autosave";
import { describeImport } from "@/lib/import";
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
import type { PageName } from "@/lib/store";
import { FLAT, type Pose } from "@/lib/paper/deform";
import { slugFromText } from "@/lib/text";
import { ComparePanel } from "./ComparePanel";
import { LibraryPanel } from "./LibraryPanel";
import { MetricsPanel } from "./MetricsPanel";
import { FitToPage } from "./FitToPage";
import { ModelsPanel, type SemanticSummary } from "./ModelsPanel";
import { A4Sheet, type A4SheetHandle } from "./A4Sheet";
import { useModels } from "./useModels";
import type { A4Plane } from "@/lib/element/a4-sheet";
import type { FindingResult, ScoreResult, TransformResult } from "@/lib/models/host";
import { SEMANTIC_REPETITION_CARD, SEMANTIC_REPETITION_ID } from "@/lib/models/semantic/card";
import { DEFAULT_VIEW, SheetControls, type SheetView } from "./SheetControls";
import { useLibrary, type Slot } from "./useLibrary";

type Mode = "single" | "compare";
type Render = "3d" | "flat";
type Zoom = { kind: "fit" } | { kind: "fixed"; mm: number };
type Toast = { message: string; tone: "info" | "warn" };

/** Rescore a model lens this long after the author stops typing. */
const RESCORE_MS = 1500;

const ZOOM_STEPS = [0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
const MIN_MM = 1.2;

const STATUS_LABEL: Record<SaveStatus, string> = {
  saved: "Saved",
  unsaved: "Unsaved changes",
  saving: "Saving…",
  error: "Save failed · retrying",
};

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

export function SaveStatusPill({ status }: { status: SaveStatus }) {
  return (
    <span className="save-pill" data-status={status} role="status" aria-live="polite">
      {STATUS_LABEL[status]}
    </span>
  );
}

function PageNameField({ name, onRename }: { name: PageName | null; onRename: (input: string) => Promise<string | null> }) {
  const [value, setValue] = useState(name ?? "");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setValue(name ?? "");
    setError(null);
  }, [name]);
  async function commit(next: string) {
    if (!name || next === name) return;
    const message = await onRename(next);
    if (message) {
      setError(message);
      setValue(name);
    }
  }
  function onKey(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") e.currentTarget.blur();
    if (e.key === "Escape") {
      setValue(name ?? "");
      e.currentTarget.blur();
    }
  }
  return (
    <span className="name-field">
      <input
        className="page-name"
        aria-label="Page name"
        value={value}
        maxLength={80}
        disabled={!name}
        onChange={(e) => {
          setValue(e.target.value);
          setError(null);
        }}
        onKeyDown={onKey}
        onBlur={(e) => void commit(e.currentTarget.value)}
      />
      {error ? <span className="name-error">{error}</span> : null}
    </span>
  );
}

export function Workbench() {
  const [presetId, setPresetId] = useState<PresetId>(DEFAULT_PRESET);
  const [lens, setLens] = useState<LensId>("ink");
  const [showGrid, setShowGrid] = useState(false);
  const [mode, setMode] = useState<Mode>("single");
  const [showLibrary, setShowLibrary] = useState(true);
  const [settingsReady, setSettingsReady] = useState(false);
  const [active, setActive] = useState<Slot>("a");
  const [render, setRender] = useState<Render>("3d");
  const [gpuMissing, setGpuMissing] = useState(false);
  const [poses, setPoses] = useState<Record<Slot, Pose>>({ a: FLAT, b: FLAT });
  const [view, setView] = useState<SheetView>(DEFAULT_VIEW);
  const sheetA = useRef<A4SheetHandle>(null);
  const sheetB = useRef<A4SheetHandle>(null);
  const [zoom, setZoom] = useState<Zoom>({ kind: "fit" });
  const [deskWidth, setDeskWidth] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const deskRef = useRef<HTMLDivElement>(null);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const menuRef = useOutsideClose(menuOpen, closeMenu);

  const notify = useCallback((message: string, tone: "info" | "warn" = "info") => {
    setToast({ message, tone });
    window.setTimeout(() => setToast((t) => (t?.message === message ? null : t)), tone === "warn" ? 8000 : 2600);
  }, []);

  const lib = useLibrary(notify);
  const spec = PRESETS[presetId];
  const ready = lib.ready && settingsReady;

  // Restore view settings after mount (the page is prerendered with defaults).
  useEffect(() => {
    const p = readKey(KEYS.preset);
    const l = readKey(KEYS.lens);
    const g = readKey(KEYS.grid);
    const m = readKey(KEYS.mode);
    const lb = readKey(KEYS.library);
    if (isPresetId(p)) setPresetId(p);
    if (isLensId(l)) setLens(l);
    if (g !== null) setShowGrid(g === "1");
    // "paper" was the old separate 3D mode; 3D is now how every sheet renders.
    if (m === "single" || m === "compare") setMode(m);
    else if (m === "paper") setMode("single");
    const r = readKey(KEYS.render);
    if (r === "3d" || r === "flat") setRender(r);
    if (lb !== null) setShowLibrary(lb === "1");
    else if (window.innerWidth < 1100) setShowLibrary(false);
    setSettingsReady(true);
  }, []);

  useEffect(() => {
    if (!settingsReady) return;
    writeKey(KEYS.preset, presetId);
    writeKey(KEYS.lens, lens);
    writeKey(KEYS.grid, showGrid ? "1" : "0");
    writeKey(KEYS.mode, mode);
    writeKey(KEYS.render, render);
    writeKey(KEYS.library, showLibrary ? "1" : "0");
  }, [settingsReady, presetId, lens, showGrid, mode, render, showLibrary]);

  // Keep slot B open exactly while comparing.
  useEffect(() => {
    if (!ready) return;
    if (mode === "compare") void lib.ensureSlotB();
    else void lib.closeSlotB();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, mode]);

  // Ctrl/Cmd+S saves now instead of opening the browser's save dialog.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void lib.flushAll().then(() => notify("Saved"));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lib, notify]);

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

  const textA = lib.slotA.text;
  const textB = lib.slotB.text;
  const analysisA = useMemo(() => analyze(textA, spec), [textA, spec]);
  const analysisB = useMemo(() => analyze(textB, spec), [textB, spec]);
  const compressA = useCompressibility(textA);
  const compressB = useCompressibility(textB);

  const target: Slot = mode === "compare" ? active : "a";
  const targetSlot = target === "a" ? lib.slotA : lib.slotB;

  // --- Models -------------------------------------------------------------
  // A model lens replaces the built-in lens while it's on; only built-in
  // lenses are saved in settings, since planes don't survive a reload.
  const models = useModels();
  const [modelLens, setModelLens] = useState<string | null>(null);
  const [scored, setScored] = useState<Record<Slot, (ScoreResult & { preset: PresetId }) | null>>({ a: null, b: null });
  const slotsShown: Slot[] = mode === "compare" ? ["a", "b"] : ["a"];

  const scoreSlot = useCallback(
    async (slot: Slot, text: string) => {
      try {
        const result = await models.score(SEMANTIC_REPETITION_ID, text, spec);
        setScored((s) => ({ ...s, [slot]: { ...result, preset: spec.id } }));
      } catch (error) {
        notify(`Semantic repetition: ${error instanceof Error ? error.message : String(error)}`, "warn");
      }
    },
    [models.score, spec, notify], // eslint-disable-line react-hooks/exhaustive-deps
  );

  function chooseLens(id: LensId) {
    setModelLens(null);
    setLens(id);
  }

  function showSemantic() {
    setModelLens(SEMANTIC_REPETITION_ID);
    for (const slot of slotsShown) void scoreSlot(slot, slot === "a" ? textA : textB);
  }

  // While the Semantic repetition lens is on, rescore each shown page 1,500 ms
  // after its text (or the preset) stops changing.
  useEffect(() => {
    if (modelLens !== SEMANTIC_REPETITION_ID || models.status[SEMANTIC_REPETITION_ID] !== "ready") return;
    const timers = slotsShown.map((slot) => {
      const text = slot === "a" ? textA : textB;
      const current = scored[slot];
      if (current && current.preset === spec.id && current.planes[0]?.text === text) return 0;
      return window.setTimeout(() => void scoreSlot(slot, text), RESCORE_MS);
    });
    return () => timers.forEach((t) => t && clearTimeout(t));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelLens, models.status, textA, textB, spec.id, mode, scoreSlot]);

  function planesFor(slot: Slot): Record<string, A4Plane> | undefined {
    const result = scored[slot];
    if (!result || result.preset !== spec.id) return undefined;
    return Object.fromEntries(result.planes.map((p) => [p.pluginId, { text: p.text, values: p.values, label: p.label }]));
  }
  const planesA = useMemo(() => planesFor("a"), [scored.a, spec.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const planesB = useMemo(() => planesFor("b"), [scored.b, spec.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const sheetLens = modelLens ? (`model:${modelLens}` as const) : lens;
  const modelLegend =
    modelLens === SEMANTIC_REPETITION_ID
      ? { plane: "Semantic repetition", plugin: SEMANTIC_REPETITION_CARD.name, model: SEMANTIC_REPETITION_CARD.model }
      : null;
  const semanticAvailable = models.status[SEMANTIC_REPETITION_ID] === "ready";

  const semanticSummary: SemanticSummary | null = (() => {
    if (modelLens !== SEMANTIC_REPETITION_ID) return null;
    const result = scored[target];
    const text = target === "a" ? textA : textB;
    if (!result) return { sheet: mode === "compare" ? target.toUpperCase() : "", restating: 0, units: 0, pairs: [], stale: true };
    const value = (name: string) => result.scores.find((x) => x.name === name)?.value ?? 0;
    return {
      sheet: mode === "compare" ? target.toUpperCase() : "",
      restating: value("restating"),
      units: value("units"),
      pairs: result.findings.filter((f) => f.kind === "restates"),
      stale: result.planes[0]?.text !== text || result.preset !== spec.id,
    };
  })();

  // Fit to page: the result opens as B, beside its source as A.
  async function openFitResult(sourceName: string, result: TransformResult) {
    setMode("compare");
    setZoom({ kind: "fit" });
    if (lib.slotA.name !== sourceName) {
      if (lib.slotB.name === sourceName) await lib.swapSlots();
      else await lib.openInSlot("a", sourceName as PageName);
    }
    const name = await lib.createPage(`${sourceName} (fit)`, result.text, "b");
    setActive("b");
    if (!name) return;
    notify(
      result.fits
        ? `Created “${name}”: it fits in ${result.rowsUsed} of ${result.rowsAllowed} rows.`
        : `Created “${name}”, but it’s still over by ${result.overBy} rows after ${result.attempts} attempts.`,
      result.fits ? "info" : "warn",
    );
  }

  function selectLaterUnit(pair: FindingResult) {
    const later = pair.spans[pair.spans.length - 1];
    const el = (target === "a" ? sheetA : sheetB).current?.element();
    if (!el || !later) return;
    el.focus();
    el.setSelectionRange(later.start, later.end);
  }

  async function newPage(desired: string, text: string) {
    setMenuOpen(false);
    const name = await lib.createPage(desired, text, target);
    if (name) notify(`Created “${name}”.`);
  }

  async function loadPair(id: string) {
    setMenuOpen(false);
    const p = SAMPLE_PAIRS.find((x) => x.id === id);
    if (!p) return;
    setMode("compare");
    setZoom({ kind: "fit" });
    await lib.createPage("Incident (JSON)", p.a, "a");
    await lib.createPage("Incident (narrative)", p.b, "b");
  }

  function clearPage() {
    setMenuOpen(false);
    if (!targetSlot.name || targetSlot.text === "") return;
    if (!window.confirm(`Clear all text on “${targetSlot.name}”?`)) return;
    lib.edit(target, "");
    (target === "a" ? sheetA : sheetB).current?.focus();
  }

  async function copyText() {
    try {
      await navigator.clipboard.writeText(targetSlot.text);
      notify(`Copied “${targetSlot.name}” (${targetSlot.text.length.toLocaleString("en-US")} characters)`);
    } catch {
      notify("Copy failed: clipboard access was blocked", "warn");
    }
  }

  function saveFile(blob: Blob, fileName: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function downloadText() {
    saveFile(new Blob([targetSlot.text], { type: "text/markdown;charset=utf-8" }), `${slugFromText(targetSlot.name ?? "")}.md`);
  }

  async function exportAll() {
    try {
      const archive = await lib.exportAll();
      if (!archive) return;
      saveFile(new Blob([archive.bytes as BlobPart], { type: "application/zip" }), archive.fileName);
      notify(`Exported ${archive.count} page${archive.count === 1 ? "" : "s"} to ${archive.fileName}`);
    } catch (error) {
      notify(`Export failed: ${error instanceof Error ? error.message : String(error)}`, "warn");
    }
  }

  async function importFile(file: File) {
    if (file.size > 100 * 1024 * 1024) {
      notify(`Couldn’t import “${file.name}”: files over 100 MB aren’t supported.`, "warn");
      return;
    }
    try {
      const report = await lib.importArchive(new Uint8Array(await file.arrayBuffer()));
      if (!report) return;
      notify(describeImport(report), report.skipped.length || report.created.some((c) => c.renamedFrom) ? "warn" : "info");
    } catch (error) {
      notify(`Couldn’t import “${file.name}”: ${error instanceof Error ? error.message : String(error)}`, "warn");
    }
  }

  const effectiveRender: Render = gpuMissing ? "flat" : render;

  function onSheetRender(reported: "3d" | "flat") {
    if (reported === "flat" && render === "3d" && !gpuMissing) {
      setGpuMissing(true);
      notify("3D needs WebGPU, which this browser doesn’t provide, so sheets are shown flat.", "warn");
    }
  }

  function setModeAndFit(next: Mode) {
    setMode(next);
    setZoom({ kind: "fit" });
    if (next !== "compare") setActive("a");
  }

  function trashPage(name: PageName) {
    if (window.confirm(`Move “${name}” to the trash? You can restore it from the trash.`)) void lib.trashPage(name);
  }

  function slotPicker(slot: Slot) {
    const state = slot === "a" ? lib.slotA : lib.slotB;
    return (
      <select
        className="select slot-select"
        aria-label={`Page in slot ${slot.toUpperCase()}`}
        value={state.name ?? ""}
        onChange={(e) => void lib.openInSlot(slot, e.target.value as PageName)}
      >
        {lib.pages.map((p) => (
          <option key={p.name} value={p.name}>
            {p.name}
          </option>
        ))}
      </select>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <Link href="/" className="brand" aria-label="A4 home">
          <span className="brand-mark">A4</span>
          <span className="brand-tag">one page of context</span>
        </Link>

        <div className="toolbar" role="toolbar" aria-label="Page controls">
          <button
            type="button"
            className="btn btn-outline"
            aria-pressed={showLibrary}
            onClick={() => setShowLibrary((s) => !s)}
            title="Show or hide the page library"
          >
            ☰ Pages
          </button>

          <div className="tool-group" title={spec.blurb}>
            <span className="tool-label">Grid</span>
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
                  aria-pressed={!modelLens && lens === l.id}
                  title={l.hint}
                  onClick={() => chooseLens(l.id)}
                >
                  {l.name}
                </button>
              ))}
              {semanticAvailable ? (
                <button
                  type="button"
                  className="lens-model"
                  aria-pressed={modelLens === SEMANTIC_REPETITION_ID}
                  title="Model lens: sentences and fields that restate one another (runs in your browser)"
                  onClick={showSemantic}
                >
                  Semantic
                </button>
              ) : null}
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
              Cells
            </button>
            <div className="seg" role="group" aria-label="View">
              <button type="button" aria-pressed={mode === "single"} onClick={() => setModeAndFit("single")}>
                Single
              </button>
              <button type="button" aria-pressed={mode === "compare"} onClick={() => setModeAndFit("compare")}>
                Compare
              </button>
            </div>
            <div className="seg" role="group" aria-label="Rendering">
              <button
                type="button"
                aria-pressed={effectiveRender === "3d"}
                disabled={gpuMissing}
                onClick={() => setRender("3d")}
                title={gpuMissing ? "3D needs WebGPU" : "Render sheets in 3D (WebGPU)"}
              >
                3D
              </button>
              <button type="button" aria-pressed={effectiveRender === "flat"} onClick={() => setRender("flat")}>
                Flat
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
              New ▾
            </button>
            {menuOpen ? (
              <div className="menu-list" role="menu">
                <button type="button" role="menuitem" className="menu-item" onClick={() => void newPage("Untitled", "")}>
                  <strong>Blank page</strong>
                  <span>Start from an empty sheet</span>
                </button>
                <div className="menu-sep" />
                <div className="menu-heading">From a narrative template</div>
                {TEMPLATES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    role="menuitem"
                    className="menu-item"
                    onClick={() => void newPage(t.name, t.text)}
                  >
                    <strong>{t.name}</strong>
                    <span>{t.blurb}</span>
                  </button>
                ))}
                <div className="menu-sep" />
                <div className="menu-heading">Worked samples</div>
                {SAMPLE_PAIRS.map((p) => (
                  <button key={p.id} type="button" role="menuitem" className="menu-item" onClick={() => void loadPair(p.id)}>
                    <strong>{p.name}</strong>
                    <span>Creates two pages and opens Compare</span>
                  </button>
                ))}
                <button type="button" role="menuitem" className="menu-item" onClick={() => void newPage("Welcome", WELCOME)}>
                  <strong>Welcome page</strong>
                  <span>What A4 is, written as one page</span>
                </button>
                <div className="menu-sep" />
                <button type="button" role="menuitem" className="menu-item" onClick={clearPage}>
                  <strong>Clear “{targetSlot.name ?? "page"}”</strong>
                  <span>Erase this page’s text (autosaved)</span>
                </button>
              </div>
            ) : null}
          </div>
          <button type="button" className="btn btn-outline" onClick={copyText}>
            Copy
          </button>
          <button type="button" className="btn btn-outline" onClick={downloadText} title="Download this page as a .md file">
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

      <div className={`workspace${showLibrary ? " with-library" : ""}`}>
        {showLibrary ? (
          <LibraryPanel
            pages={lib.pages}
            trash={lib.trash}
            open={{ a: lib.slotA.name, b: mode === "compare" ? lib.slotB.name : null }}
            compare={mode === "compare"}
            activeSlot={target}
            storage={lib.storage}
            onOpen={(name, slot) => {
              setActive(slot);
              void lib.openInSlot(slot, name);
              if (window.innerWidth < 1100) setShowLibrary(false);
            }}
            onNew={() => void newPage("Untitled", "")}
            onRename={lib.renamePage}
            onDuplicate={(name) => void lib.duplicatePage(name)}
            onTrash={trashPage}
            onRestore={(id) => void lib.restorePage(id)}
            onPurge={(ids) => void lib.purgePages(ids)}
            onExportAll={() => void exportAll()}
            onImport={(file) => void importFile(file)}
          />
        ) : null}

        <main className="desk" ref={deskRef}>
          {lib.failure ? (
            <div className="banner" role="alert">
              Couldn’t open page storage: {lib.failure}
            </div>
          ) : null}
          {mode === "single" ? (
            <div className="docbar">
              <PageNameField name={lib.slotA.name} onRename={(input) => lib.renamePage(lib.slotA.name!, input)} />
              <SaveStatusPill status={lib.slotA.status} />
            </div>
          ) : null}
          {effectiveRender === "3d" ? (
            <SheetControls
              active={target}
              compare={mode === "compare"}
              pose={poses[target]}
              onPose={(pose) => setPoses((p) => ({ ...p, [target]: pose }))}
              view={view}
              onView={setView}
              onFold={() => (target === "a" ? sheetA : sheetB).current?.fold()}
              onReset={() => {
                setPoses({ a: FLAT, b: FLAT });
                setView(DEFAULT_VIEW);
              }}
            />
          ) : null}
          <div className={`sheets render-${effectiveRender}`}>
            {(["a", "b"] as const)
              .filter((slot) => slot === "a" || mode === "compare")
              .map((slot) => {
                const state = slot === "a" ? lib.slotA : lib.slotB;
                const analysis = slot === "a" ? analysisA : analysisB;
                return (
                  <div key={slot} className="sheet-col" data-active={mode === "compare" && target === slot ? "" : undefined}>
                    {mode === "compare" ? (
                      <div className="sheet-caption">
                        <b>{slot.toUpperCase()}</b>
                        {slotPicker(slot)}
                        <SaveStatusPill status={state.status} />
                        <span>
                          {analysis.verdict} · ≈{analysis.tokens.toLocaleString("en-US")} tokens
                        </span>
                      </div>
                    ) : null}
                    <A4Sheet
                      ref={slot === "a" ? sheetA : sheetB}
                      className={!ready || !state.name ? "sheet-hidden" : undefined}
                      value={state.text}
                      onValue={(t) => lib.edit(slot, t)}
                      onFocus={() => setActive(slot)}
                      onRender={onSheetRender}
                      onViewChange={({ tilt, turn }) => setView((v) => ({ ...v, tilt, turn }))}
                      onPoseChange={(pose) => setPoses((p) => ({ ...p, [slot]: pose }))}
                      preset={presetId}
                      lens={sheetLens}
                      planes={slot === "a" ? planesA : planesB}
                      render={effectiveRender}
                      pose={poses[slot]}
                      tilt={view.tilt}
                      turn={view.turn}
                      light={view.light}
                      zoom={zoom.kind === "fit" ? null : zoom.mm}
                      grid={showGrid}
                      label={`${state.name ?? `Page ${slot.toUpperCase()}`}: A4 page, ${spec.cols} columns by ${spec.rows} rows`}
                    />
                  </div>
                );
              })}
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
              modelLegend={modelLegend}
              onSwap={() => void lib.swapSlots()}
              onCopyAToB={() => {
                if (lib.slotA.name) void lib.duplicatePage(lib.slotA.name, "b");
              }}
            />
          ) : (
            <MetricsPanel analysis={analysisA} spec={spec} lens={lens} modelLegend={modelLegend} compress={compressA} />
          )}
          <ModelsPanel
            models={models}
            semanticActive={modelLens === SEMANTIC_REPETITION_ID}
            onScore={() => showSemantic()}
            summary={semanticSummary}
            onSelectPair={selectLaterUnit}
            fit={
              <FitToPage
                page={{ name: targetSlot.name, text: targetSlot.text }}
                spec={spec}
                host={models.host}
                onResult={openFitResult}
              />
            }
          />
        </aside>
      </div>

      {toast ? (
        <div className="toast" role="status" data-tone={toast.tone}>
          {toast.message}
        </div>
      ) : null}
    </div>
  );
}
