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
import { slugFromText } from "@/lib/text";
import { ComparePanel } from "./ComparePanel";
import { LibraryPanel } from "./LibraryPanel";
import { MetricsPanel } from "./MetricsPanel";
import { Sheet } from "./Sheet";
import { useLibrary, type Slot } from "./useLibrary";

type Mode = "single" | "compare";
type Zoom = { kind: "fit" } | { kind: "fixed"; mm: number };
type Toast = { message: string; tone: "info" | "warn" };

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
    if (m === "single" || m === "compare") setMode(m);
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
    writeKey(KEYS.library, showLibrary ? "1" : "0");
  }, [settingsReady, presetId, lens, showGrid, mode, showLibrary]);

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
    document.getElementById(`sheet-${target}`)?.focus();
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

  function setModeAndFit(next: Mode) {
    setMode(next);
    setZoom({ kind: "fit" });
    if (next === "single") setActive("a");
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
          <div className="sheets">
            <div className="sheet-col">
              {mode === "compare" ? (
                <div className="sheet-caption">
                  <b>A</b>
                  {slotPicker("a")}
                  <SaveStatusPill status={lib.slotA.status} />
                  <span>
                    {analysisA.verdict} · ≈{analysisA.tokens.toLocaleString("en-US")} tokens
                  </span>
                </div>
              ) : null}
              <Sheet
                id="sheet-a"
                label={lib.slotA.name ?? "Page A"}
                text={textA}
                onChange={(t) => lib.edit("a", t)}
                onFocus={() => setActive("a")}
                spec={spec}
                lens={lens}
                showGrid={showGrid}
                mm={mm}
                analysis={analysisA}
                hidden={!ready || !lib.slotA.name}
              />
            </div>
            {mode === "compare" ? (
              <div className="sheet-col">
                <div className="sheet-caption">
                  <b>B</b>
                  {slotPicker("b")}
                  <SaveStatusPill status={lib.slotB.status} />
                  <span>
                    {analysisB.verdict} · ≈{analysisB.tokens.toLocaleString("en-US")} tokens
                  </span>
                </div>
                <Sheet
                  id="sheet-b"
                  label={lib.slotB.name ?? "Page B"}
                  text={textB}
                  onChange={(t) => lib.edit("b", t)}
                  onFocus={() => setActive("b")}
                  spec={spec}
                  lens={lens}
                  showGrid={showGrid}
                  mm={mm}
                  analysis={analysisB}
                  hidden={!ready || !lib.slotB.name}
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
              onSwap={() => void lib.swapSlots()}
              onCopyAToB={() => {
                if (lib.slotA.name) void lib.duplicatePage(lib.slotA.name, "b");
              }}
            />
          ) : (
            <MetricsPanel analysis={analysisA} spec={spec} lens={lens} compress={compressA} />
          )}
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
