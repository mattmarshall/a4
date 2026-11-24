"use client";

/**
 * The app: the top bar, the page library, the desk, and the inspector, around
 * the tab's workspace. Each piece owns its own state (see components/workbench):
 * layout and shortcuts here, pose and camera in the stage, scoring in the
 * semantic lens.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { describeImport } from "@/lib/archive";
import { type LensId, PRESETS } from "@/lib/page";
import {
  Operation,
  FIT_TO_PAGE,
  FitJob,
  type FindingResult,
  type TransformResult,
  SEMANTIC_REPETITION,
} from "@/lib/models";
import { SAMPLE_PAIRS } from "@/lib/content";
import { SETTINGS, copyNameFor, sameRef, type PageName, type PageRef } from "@/lib/persist";
import type { Slot } from "@/lib/workspace";
import type { A4SheetHandle } from "./A4Sheet";
import { ComparePanel } from "./ComparePanel";
import { FitJobChip, FitToPage, type KeyStore } from "./FitToPage";
import { LibraryPanel, type FolderActions, type PageActions } from "./LibraryPanel";
import { LensLegend, MetricsPanel } from "./MetricsPanel";
import { ModelsPanel, SemanticSummaryView } from "./ModelsPanel";
import { useModels } from "./useModels";
import { useSetting } from "./useSetting";
import { saveFile } from "./workbench/download";
import { HelpMenu, PageMenu, ViewMenu } from "./workbench/menus";
import { SheetStage } from "./workbench/SheetStage";
import { DocTitle, Topbar } from "./workbench/Topbar";
import { useAnalysis } from "./workbench/useAnalysis";
import { useLayout } from "./workbench/useLayout";
import { useSemanticLens } from "./workbench/useSemanticLens";
import { useShortcuts } from "./workbench/useShortcuts";
import { useWorkspaceApi } from "./workspace/useWorkspace";

type Toast = { message: string; tone: "info" | "warn" };

function useToast() {
  const [toast, setToast] = useState<Toast | null>(null);
  const notify = useCallback((message: string, tone: "info" | "warn" = "info") => {
    setToast({ message, tone });
    window.setTimeout(() => setToast((t) => (t?.message === message ? null : t)), tone === "warn" ? 8000 : 2600);
  }, []);
  return [toast, notify] as const;
}

export function Workbench() {
  const [toast, notify] = useToast();
  const lib = useWorkspaceApi(notify);
  const layout = useLayout();
  const [presetId] = useSetting(SETTINGS.preset);
  const [lens, setLens] = useSetting(SETTINGS.lens);
  const [grid] = useSetting(SETTINGS.grid);
  const [render] = useSetting(SETTINGS.render);
  const [gpuMissing, setGpuMissing] = useState(false);
  /** "Save to folder…" was chosen: the Pages panel asks for a path. */
  const [saveRequest, setSaveRequest] = useState<{ name: PageName; slot: Slot } | null>(null);
  const sheetA = useRef<A4SheetHandle>(null);
  const sheetB = useRef<A4SheetHandle>(null);
  const handles = { a: sheetA, b: sheetB };

  const spec = PRESETS[presetId];
  const { compare, target, setMode, setActive } = layout;
  const { slots, ready } = lib;
  const page = slots[target];
  const a = useAnalysis(slots.a.text, spec);
  const b = useAnalysis(slots.b.text, spec);
  const targetAnalysis = target === "a" ? a.analysis : b.analysis;
  const effectiveRender = gpuMissing ? "flat" : render;

  // Keep slot B open exactly while comparing.
  const { ensureSlotB, closeSlotB, flushAll } = lib;
  useEffect(() => {
    if (!ready) return;
    if (compare) void ensureSlotB();
    else void closeSlotB();
  }, [ready, compare, ensureSlotB, closeSlotB]);

  useShortcuts({
    save: () =>
      void flushAll().then((saved) =>
        saved ? notify("Saved") : notify("Saving failed. A4 keeps your edits and will keep trying.", "warn"),
      ),
    toggleFocus: () => layout.setFocus(!layout.focus),
    escape: layout.dismiss,
  });

  // --- Models --------------------------------------------------------------
  const models = useModels();
  const semantic = useSemanticLens({
    models,
    notify,
    texts: { a: slots.a.text, b: slots.b.text },
    spec,
    compare,
    target,
    lens,
  });

  function chooseLens(id: LensId) {
    semantic.off();
    setLens(id);
  }

  // Fit to page: one request at a time, owned here so it outlives the Models
  // panel (collapsing it, hiding the inspector, or focus mode don't stop it).
  // The result opens as B, beside its source as A.
  async function openFitResult(result: TransformResult, ref: PageRef | null) {
    // The dialog only opens for an open page, so a reference is always present.
    if (!ref) return;
    setMode("compare");
    if (!sameRef(slots.a.ref, ref)) {
      if (sameRef(slots.b.ref, ref)) await lib.swapSlots();
      else await lib.openInSlot("a", ref);
    }
    // Copies of folder files go to the library, named after the path.
    const name = await lib.createPage(copyNameFor(ref, " (fit)"), result.text, "b");
    setActive("b");
    if (!name) return;
    notify(
      result.fits
        ? `Created “${name}”: it fits in ${result.rowsUsed} of ${result.rowsAllowed} rows.`
        : `Created “${name}”, but it’s still over by ${result.overBy} rows after ${result.attempts} attempts.`,
      result.fits ? "info" : "warn",
    );
  }
  // Fit to page's API key, in the host's credential store (the host loads on first use).
  const fitKey = useMemo((): KeyStore => {
    const kind = FIT_TO_PAGE.names.credentials.apiKey;
    return {
      has: async () => (await models.host()).credentials.has(FIT_TO_PAGE.id, kind),
      set: async (value) => (await models.host()).credentials.set(FIT_TO_PAGE.id, kind, value),
      forget: async () => (await models.host()).credentials.forget(FIT_TO_PAGE.id, kind),
    };
  }, [models.host]);
  const fitDeps = useRef({ spec, openFitResult });
  useEffect(() => {
    fitDeps.current = { spec, openFitResult };
  });
  const [fitJob] = useState(
    () =>
      new FitJob<PageRef>({
        grant: async (text) =>
          (await models.host()).consent.request(FIT_TO_PAGE.id, Operation.TRANSFORM, text).approve(),
        run: async (text, options) =>
          (await models.host()).transform(FIT_TO_PAGE.id, text, fitDeps.current.spec, {
            instruction: FIT_TO_PAGE.names.instructions.fit,
            ...options,
          }),
        onResult: (_name, result, ref) => fitDeps.current.openFitResult(result, ref),
        onAuthFailed: () => void fitKey.forget(),
      }),
  );

  function selectLaterUnit(pair: FindingResult) {
    const later = pair.spans[pair.spans.length - 1];
    const el = handles[target].current?.element();
    if (!el || !later) return;
    el.focus();
    el.setSelectionRange(later.start, later.end);
  }

  // --- Page commands ---------------------------------------------------------

  async function newPage(desired: string, text: string) {
    const name = await lib.createPage(desired, text, target);
    if (name) notify(`Created “${name}”.`);
  }

  async function loadPair(id: string) {
    const pair = SAMPLE_PAIRS.find((x) => x.id === id);
    if (!pair) return;
    setMode("compare");
    await lib.createPage("Incident (JSON)", pair.a, "a");
    await lib.createPage("Incident (narrative)", pair.b, "b");
  }

  function clearPage() {
    if (!page.label || page.text === "") return;
    if (!window.confirm(`Clear all text on “${page.label}”?`)) return;
    lib.edit(target, "");
    handles[target].current?.focus();
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
      notify(
        describeImport(report),
        report.skipped.length || report.created.some((c) => c.renamedFrom) ? "warn" : "info",
      );
    } catch (error) {
      notify(`Couldn’t import “${file.name}”: ${error instanceof Error ? error.message : String(error)}`, "warn");
    }
  }

  function trashPage(name: PageName) {
    if (window.confirm(`Move “${name}” to the trash? You can restore it from the trash.`)) {
      void lib.trashPage(name);
    }
  }

  function openInSlot(slot: Slot, ref: PageRef) {
    setActive(slot);
    void lib.openInSlot(slot, ref, `open “${ref.kind === "file" ? ref.path : ref.name}”`).then(() => {
      if (layout.narrow) layout.setLibrary(false);
    });
  }

  async function duplicate(ref: PageRef) {
    if (ref.kind === "library") {
      await lib.duplicatePage(ref, `duplicate “${ref.name}”`);
      return;
    }
    const name = await lib.duplicatePage(ref, `copy “${ref.path}” into the library`);
    if (name) notify(`Copied “${ref.path}” into the library as “${name}”.`);
  }

  const pageActions: PageActions = {
    create: () => void newPage("Untitled", ""),
    rename: lib.renamePage,
    duplicate: (ref) => void duplicate(ref),
    trash: trashPage,
    restore: (id) => void lib.restorePage(id),
    purge: (ids) => void lib.purgePages(ids),
    exportAll: () => void exportAll(),
    importArchive: (file) => void importFile(file),
  };

  const folderActions: FolderActions = {
    pick: () => void lib.openFolder(),
    reconnect: () => void lib.reconnectFolder(),
    close: () => void lib.closeFolder(),
    createFile: (path) => lib.createFile(path, "", target),
    saveTo: async (path) => {
      if (!saveRequest) return null;
      const error = await lib.saveToFolder(saveRequest.name, path, saveRequest.slot);
      if (!error) setSaveRequest(null);
      return error;
    },
    cancelSave: () => setSaveRequest(null),
  };

  function onSheetRender(reported: "3d" | "flat") {
    if (reported === "flat" && render === "3d" && !gpuMissing) {
      setGpuMissing(true);
      notify("3D needs WebGPU, which this browser doesn’t provide, so sheets are shown flat.", "warn");
    }
  }

  const folderState = lib.folder.state;
  const folderName =
    folderState.status === "connected" || folderState.status === "reconnect" ? folderState.name : "Folder";
  const { focus } = layout;
  const showLibrary = layout.library && !focus;
  const showInspector = layout.inspector && !focus;
  const legendShown = Boolean(semantic.active) || lens !== "ink";

  return (
    <div className="app" data-focus={focus ? "" : undefined}>
      {!focus ? (
        <Topbar
          layout={layout}
          title={<DocTitle page={page} folderName={folderName} onRename={lib.renamePage} />}
          fitJob={fitJob}
          lens={lens}
          semantic={semantic}
          onLens={chooseLens}
          verdict={targetAnalysis.assessment.verdict}
        >
          <PageMenu
            page={page}
            notify={notify}
            onNewPage={(desired, text) => void newPage(desired, text)}
            onLoadPair={(id) => void loadPair(id)}
            onClear={clearPage}
            saveToFolder={
              folderState.status === "connected" && page.ref?.kind === "library"
                ? {
                    folder: folderState.name,
                    onSelect: () => {
                      if (page.ref?.kind !== "library") return;
                      setSaveRequest({ name: page.ref.name, slot: target });
                      layout.setLibrary(true);
                    },
                  }
                : null
            }
          />
          <ViewMenu layout={layout} gpuMissing={gpuMissing} />
          <HelpMenu />
        </Topbar>
      ) : null}

      <div className={`workspace${showLibrary ? " with-library" : ""}${showInspector ? " with-inspector" : ""}`}>
        {showLibrary ? (
          <LibraryPanel
            pages={lib.pages}
            trash={lib.trash}
            storage={lib.storage}
            folder={lib.folder}
            open={{ a: slots.a.ref, b: compare ? slots.b.ref : null }}
            compare={compare}
            activeSlot={target}
            saveRequest={saveRequest}
            onOpen={(ref, slot) => openInSlot(slot, ref)}
            pageActions={pageActions}
            folderActions={folderActions}
          />
        ) : null}

        <SheetStage
          handles={handles}
          slots={slots}
          analyses={{ a: a.analysis, b: b.analysis }}
          compare={compare}
          target={target}
          ready={ready}
          failure={lib.failure}
          spec={spec}
          lens={semantic.sheetLens}
          planes={semantic.planes}
          render={effectiveRender}
          zoom={layout.sheetMm(effectiveRender === "flat")}
          grid={grid}
          pages={lib.pages}
          folder={lib.folder}
          deskRef={layout.deskRef}
          stageHeight={layout.stageHeight}
          focus={focus}
          posePanel={layout.posePanel}
          onPosePanel={layout.setPosePanel}
          onOpen={(slot, ref) => openInSlot(slot, ref)}
          onEdit={lib.edit}
          onActivate={setActive}
          onRender={onSheetRender}
        >
          {legendShown && !focus ? (
            <div className="lens-chip" role="group" aria-label="Lens legend" data-print="hide">
              <LensLegend lens={lens} model={semantic.legend} />
            </div>
          ) : null}
          {focus ? (
            <div className="focus-bar" data-print="hide">
              <FitJobChip job={fitJob} />
              <button type="button" className="btn btn-outline focus-exit" onClick={() => layout.setFocus(false)}>
                Exit focus (Esc)
              </button>
            </div>
          ) : null}
        </SheetStage>

        {showInspector ? (
          <aside className="inspector" aria-label="Inspector" data-print="hide">
            <div className="inspector-head">
              <span>Inspector</span>
              <button
                type="button"
                className="btn"
                onClick={() => layout.setInspector(false)}
                aria-label="Close the inspector"
              >
                ×
              </button>
            </div>
            {compare ? (
              <ComparePanel
                a={a.analysis}
                b={b.analysis}
                compressA={a.compress}
                compressB={b.compress}
                onSwap={() => void lib.swapSlots()}
                onCopyAToB={() => {
                  const ref = slots.a.ref;
                  if (ref) void lib.duplicatePage(ref, "copy page A into B", "b");
                }}
              />
            ) : (
              <MetricsPanel analysis={a.analysis} spec={spec} compress={a.compress} />
            )}
            <ModelsPanel
              models={models}
              scoreActive={semantic.active === SEMANTIC_REPETITION.id}
              onScore={semantic.show}
              slots={{
                [FIT_TO_PAGE.id]: (
                  <FitToPage page={{ name: page.label, ref: page.ref, text: page.text }} job={fitJob} apiKey={fitKey} />
                ),
                [SEMANTIC_REPETITION.id]: semantic.summary ? (
                  <SemanticSummaryView summary={semantic.summary} onSelectPair={selectLaterUnit} />
                ) : null,
              }}
            />
          </aside>
        ) : null}
      </div>

      {toast ? (
        <div className="toast" role="status" data-tone={toast.tone} data-print="hide">
          {toast.message}
        </div>
      ) : null}
    </div>
  );
}
