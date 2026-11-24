"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from "react";
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
import { LensLegend, MetricsPanel, VerdictChip } from "./MetricsPanel";
import { Menu, MenuItem } from "./Menu";
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


export function SaveStatusPill({ status }: { status: SaveStatus }) {
  return (
    <span className="save-pill" data-status={status} role="status" aria-live="polite" title={STATUS_LABEL[status]}>
      <span className="save-label">{STATUS_LABEL[status]}</span>
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
  const [desk, setDesk] = useState({ width: 0, height: 0 });
  const [showInspector, setShowInspector] = useState(true);
  const [posePanel, setPosePanel] = useState(false);
  const [focus, setFocus] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const deskRef = useRef<HTMLDivElement>(null);

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
    const ins = readKey(KEYS.inspector);
    if (ins !== null) setShowInspector(ins === "1");
    else if (window.innerWidth < 1100) setShowInspector(false);
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
    writeKey(KEYS.inspector, showInspector ? "1" : "0");
  }, [settingsReady, presetId, lens, showGrid, mode, render, showLibrary, showInspector]);

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

  // Focus mode: F toggles it when nothing editable has focus; Esc closes the
  // pose panel first, then leaves focus mode.
  useEffect(() => {
    function editable(el: Element | null): boolean {
      if (!el || el === document.body) return false;
      const tag = el.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || tag === "A4-SHEET" || (el as HTMLElement).isContentEditable;
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (posePanel) setPosePanel(false);
        else if (focus) setFocus(false);
        return;
      }
      if ((e.key === "f" || e.key === "F") && !e.metaKey && !e.ctrlKey && !e.altKey && !editable(document.activeElement)) {
        e.preventDefault();
        setFocus((f) => !f);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [posePanel, focus]);

  // Track the desk's size: the page fits both its width and its height.
  useEffect(() => {
    const el = deskRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setDesk({ width: entry.contentRect.width, height: entry.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pages = mode === "compare" ? 2 : 1;
  /** Height the captions take above each sheet in Compare. */
  const captionHeight = mode === "compare" ? 40 : 0;
  /** The 3D stage fills the desk's height (less the Compare captions). */
  const stageHeight = Math.max(320, Math.floor(desk.height - captionHeight));
  const fitMm = useMemo(() => {
    if (!desk.width || !desk.height) return PX_PER_MM_ACTUAL;
    const gap = 28 * (pages - 1);
    const byWidth = (desk.width - gap) / (210 * pages);
    const byHeight = (desk.height - captionHeight) / 297;
    return Math.max(MIN_MM, Math.min(PX_PER_MM_ACTUAL, byWidth, byHeight));
  }, [desk.width, desk.height, pages, captionHeight]);
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
      ? {
          plane: "Semantic repetition",
          plugin: SEMANTIC_REPETITION_CARD.name,
          model: SEMANTIC_REPETITION_CARD.model,
          scale: "similarity 0.60 → 1.00",
          note: "Darker means closer in meaning. 0.85 or more counts as restating.",
        }
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
      pairs: result.findings.filter((f) => f.kind === "similar"),
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
    const name = await lib.createPage(desired, text, target);
    if (name) notify(`Created “${name}”.`);
  }

  async function loadPair(id: string) {
    const p = SAMPLE_PAIRS.find((x) => x.id === id);
    if (!p) return;
    setMode("compare");
    setZoom({ kind: "fit" });
    await lib.createPage("Incident (JSON)", p.a, "a");
    await lib.createPage("Incident (narrative)", p.b, "b");
  }

  function clearPage() {
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

  const targetAnalysis = target === "a" ? analysisA : analysisB;
  const legendShown = Boolean(modelLens) || lens !== "ink";
  const sheetsStyle = { "--a4-3d-height": `${stageHeight}px` } as CSSProperties;

  return (
    <div className="app" data-focus={focus ? "" : undefined}>
      {!focus ? (
        <header className="topbar">
          <Link href="/" className="brand" aria-label="A4 home">
            <span className="brand-mark">A4</span>
          </Link>

          <div className="toolbar" role="toolbar" aria-label="Page controls">
            <button
              type="button"
              className="btn btn-outline"
              aria-pressed={showLibrary}
              onClick={() => setShowLibrary((s) => !s)}
              title="Show or hide the page library"
            >
              <span aria-hidden="true">☰</span>
              <span className="btn-label">Pages</span>
            </button>

            <div className="doc-title">
              <PageNameField name={targetSlot.name} onRename={(input) => lib.renamePage(targetSlot.name!, input)} />
              <SaveStatusPill status={targetSlot.status} />
            </div>

            <span className="spacer" />

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

            <div className="seg" role="group" aria-label="View">
              <button type="button" aria-pressed={mode === "single"} onClick={() => setModeAndFit("single")}>
                Single
              </button>
              <button type="button" aria-pressed={mode === "compare"} onClick={() => setModeAndFit("compare")}>
                Compare
              </button>
            </div>

            <div className="tool-group zoom" aria-label="Zoom">
              <button type="button" className="btn" onClick={() => stepZoom(-1)} aria-label="Zoom out">
                −
              </button>
              <button
                type="button"
                className="btn zoom-value"
                aria-live="polite"
                title={zoom.kind === "fit" ? "Fitting the page to the desk" : "Fit the page to the desk"}
                onClick={() => setZoom({ kind: "fit" })}
              >
                {zoomPct}%
              </button>
              <button type="button" className="btn" onClick={() => stepZoom(1)} aria-label="Zoom in">
                +
              </button>
            </div>

            <Menu label="Page" title="New page, copy, download, print">
              {(close) => (
                <>
                  <div className="menu-heading">New</div>
                  <MenuItem close={close} onSelect={() => void newPage("Untitled", "")}>
                    <strong>Blank page</strong>
                    <span>Start from an empty sheet</span>
                  </MenuItem>
                  {TEMPLATES.map((t) => (
                    <MenuItem key={t.id} close={close} onSelect={() => void newPage(t.name, t.text)}>
                      <strong>{t.name}</strong>
                      <span>{t.blurb}</span>
                    </MenuItem>
                  ))}
                  {SAMPLE_PAIRS.map((p) => (
                    <MenuItem key={p.id} close={close} onSelect={() => void loadPair(p.id)}>
                      <strong>{p.name}</strong>
                      <span>Worked sample: creates two pages and opens Compare</span>
                    </MenuItem>
                  ))}
                  <MenuItem close={close} onSelect={() => void newPage("Welcome", WELCOME)}>
                    <strong>Welcome page</strong>
                    <span>What A4 is, written as one page</span>
                  </MenuItem>
                  <div className="menu-sep" />
                  <MenuItem close={close} onSelect={() => void copyText()}>
                    <strong>Copy text</strong>
                  </MenuItem>
                  <MenuItem close={close} onSelect={downloadText}>
                    <strong>Download .md</strong>
                  </MenuItem>
                  <MenuItem close={close} onSelect={() => window.print()}>
                    <strong>Print</strong>
                  </MenuItem>
                  <div className="menu-sep" />
                  <MenuItem close={close} onSelect={clearPage}>
                    <strong>Clear “{targetSlot.name ?? "page"}”</strong>
                    <span>Erase this page’s text (autosaved)</span>
                  </MenuItem>
                </>
              )}
            </Menu>

            <Menu label="View" title="Grid, rendering, zoom, pose, focus mode">
              {(close) => (
                <>
                  <div className="menu-heading">Grid</div>
                  {PRESET_ORDER.map((id) => (
                    <MenuItem key={id} kind="radio" checked={presetId === id} close={close} onSelect={() => setPresetId(id)}>
                      <strong>
                        {PRESETS[id].name} · {PRESETS[id].cols}×{PRESETS[id].rows}
                      </strong>
                      <span>{PRESETS[id].blurb}</span>
                    </MenuItem>
                  ))}
                  <MenuItem kind="checkbox" checked={showGrid} close={close} onSelect={() => setShowGrid((g) => !g)}>
                    <strong>Show cell grid</strong>
                  </MenuItem>
                  <div className="menu-sep" />
                  <div className="menu-heading">Rendering</div>
                  <MenuItem
                    kind="radio"
                    checked={effectiveRender === "3d"}
                    disabled={gpuMissing}
                    title={gpuMissing ? "3D needs WebGPU" : undefined}
                    close={close}
                    onSelect={() => setRender("3d")}
                  >
                    <strong>3D</strong>
                    <span>Paper you can fold, curl, and light (WebGPU)</span>
                  </MenuItem>
                  <MenuItem kind="radio" checked={effectiveRender === "flat"} close={close} onSelect={() => setRender("flat")}>
                    <strong>Flat</strong>
                  </MenuItem>
                  <div className="menu-sep" />
                  <div className="menu-heading">Zoom</div>
                  <MenuItem kind="radio" checked={zoom.kind === "fit"} close={close} onSelect={() => setZoom({ kind: "fit" })}>
                    <strong>Fit to the desk</strong>
                  </MenuItem>
                  <MenuItem
                    kind="radio"
                    checked={zoom.kind === "fixed" && Math.abs(zoom.mm - PX_PER_MM_ACTUAL) < 0.01}
                    close={close}
                    onSelect={() => setZoom({ kind: "fixed", mm: PX_PER_MM_ACTUAL })}
                  >
                    <strong>Actual size (1:1)</strong>
                    <span>1 mm on screen per mm of paper (96 dpi)</span>
                  </MenuItem>
                  <div className="menu-sep" />
                  <MenuItem
                    kind="checkbox"
                    checked={posePanel}
                    disabled={effectiveRender !== "3d"}
                    close={close}
                    onSelect={() => setPosePanel((v) => !v)}
                  >
                    <strong>Pose and camera</strong>
                    <span>Fold, curl, tilt, turn, and light</span>
                  </MenuItem>
                  <MenuItem kind="checkbox" checked={focus} close={close} onSelect={() => setFocus(true)}>
                    <strong>Focus mode</strong>
                    <span>Just the page and the desk. F to toggle, Esc to leave</span>
                  </MenuItem>
                </>
              )}
            </Menu>

            <Menu label="Help">
              {() => (
                <>
                  <Link href="/why" role="menuitem" className="menu-item">
                    <strong>Why A4?</strong>
                    <span>The problem, the method, and narrative data for agents</span>
                  </Link>
                  <Link href="/element" role="menuitem" className="menu-item">
                    <strong>The &lt;a4-sheet&gt; element</strong>
                    <span>Embed an editable page anywhere</span>
                  </Link>
                </>
              )}
            </Menu>

            {!showInspector ? <VerdictChip verdict={targetAnalysis.verdict} /> : null}
            <button
              type="button"
              className="btn btn-outline"
              aria-pressed={showInspector}
              onClick={() => setShowInspector((v) => !v)}
              title="Show or hide the inspector"
            >
              Inspector
            </button>
          </div>
        </header>
      ) : null}

      <div
        className={`workspace${showLibrary && !focus ? " with-library" : ""}${showInspector && !focus ? " with-inspector" : ""}`}
      >
        {showLibrary && !focus ? (
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

        <main className="desk-frame">
          <div className="desk" ref={deskRef}>
            {lib.failure ? (
              <div className="banner" role="alert">
                Couldn’t open page storage: {lib.failure}
              </div>
            ) : null}
            <div className={`sheets render-${effectiveRender}`} style={sheetsStyle}>
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
                        zoom={zoom.kind === "fit" ? (effectiveRender === "flat" ? fitMm : null) : zoom.mm}
                        grid={showGrid}
                        label={`${state.name ?? `Page ${slot.toUpperCase()}`}: A4 page, ${spec.cols} columns by ${spec.rows} rows`}
                      />
                    </div>
                  );
                })}
            </div>
          </div>

          {effectiveRender === "3d" && !focus ? (
            <div className="desk-tools">
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => (target === "a" ? sheetA : sheetB).current?.fold()}
                title="Play the letter fold"
              >
                ▶ Fold
              </button>
              <button
                type="button"
                className="btn btn-outline"
                aria-pressed={posePanel}
                aria-expanded={posePanel}
                onClick={() => setPosePanel((v) => !v)}
                title="Fold, curl, tilt, turn, and light"
              >
                Pose…
              </button>
            </div>
          ) : null}

          {posePanel && effectiveRender === "3d" && !focus ? (
            <div className="pose-panel" role="dialog" aria-label="Pose and camera">
              <button type="button" className="btn pose-close" onClick={() => setPosePanel(false)} aria-label="Close pose and camera">
                ×
              </button>
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
            </div>
          ) : null}

          {legendShown && !focus ? (
            <div className="lens-chip" aria-label="Lens legend">
              <LensLegend lens={lens} model={modelLens ? modelLegend : null} />
            </div>
          ) : null}

          {focus ? (
            <button type="button" className="btn btn-outline focus-exit" onClick={() => setFocus(false)}>
              Exit focus (Esc)
            </button>
          ) : null}
        </main>

        {showInspector && !focus ? (
          <aside className="sidebar inspector" aria-label="Inspector">
            <div className="inspector-head">
              <span>Inspector</span>
              <button type="button" className="btn" onClick={() => setShowInspector(false)} aria-label="Close the inspector">
                ×
              </button>
            </div>
            {mode === "compare" ? (
              <ComparePanel
                a={analysisA}
                b={analysisB}
                compressA={compressA}
                compressB={compressB}
                onSwap={() => void lib.swapSlots()}
                onCopyAToB={() => {
                  if (lib.slotA.name) void lib.duplicatePage(lib.slotA.name, "b");
                }}
              />
            ) : (
              <MetricsPanel analysis={analysisA} spec={spec} compress={compressA} />
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
        ) : null}
      </div>

      {toast ? (
        <div className="toast" role="status" data-tone={toast.tone}>
          {toast.message}
        </div>
      ) : null}
    </div>
  );
}
