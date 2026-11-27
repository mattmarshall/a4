"use client";

/**
 * The app: the top bar, the page library, the desk, and the inspector, around
 * the tab's workspace. Each piece owns its own state (see components/workbench):
 * layout and shortcuts here, pose and camera in the stage, scoring in the
 * model lens.
 */

import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { describeImport, MAX_IMPORT_FILE_BYTES } from "@/lib/archive";
import type { LensId } from "@/lib/page";
import {
  type ModelCard,
  type FindingResult,
  type PluginId,
  pluginIdOf,
  type TransformResult,
  SEMANTIC_REPETITION,
} from "@/lib/models";
import { SAMPLE_PAIRS, TEMPLATES } from "@/lib/content";
import { isLetterPath, LetterState } from "@/lib/desk";
import {
  SETTINGS,
  DEFAULT_SERVE_PORT,
  baseName,
  copyNameFor,
  fileRef,
  sameRef,
  servedConnection,
  type PageName,
  type PageRef,
} from "@/lib/persist";
import { type SharePageInput, ShareError, shareLink } from "@/lib/share";
import type { Slot } from "@/lib/workspace";
import type { A4SheetHandle } from "./A4Sheet";
import { formatByteLimit } from "./analysis-copy";
import { ComparePanel } from "./ComparePanel";
import { ConsentDialog } from "./ConsentDialog";
import { LibraryPanel, type FolderActions, type LibraryActions, type PageActions } from "./LibraryPanel";
import { LensLegend, MetricsPanel } from "./MetricsPanel";
import { ModelsPanel, SemanticSummaryView } from "./ModelsPanel";
import { PenJobChip, PenPanel } from "./PenPanel";
import { penSuffix, publisherNote } from "./plugin-copy";
import { badConnection, connectFailed } from "./served-copy";
import { CLIPBOARD_BLOCKED, copiedNotice } from "./share-copy";
import { SealDialog, SealedChip, type SealVerdict } from "./SealDialog";
import { useModels } from "./useModels";
import { useSetting } from "./useSetting";
import { saveFile } from "./workbench/download";
import { HelpMenu, PageMenu, ViewMenu } from "./workbench/menus";
import { SheetStage } from "./workbench/SheetStage";
import { stageOf } from "./workbench/stage";
import { DocTitle, Topbar } from "./workbench/Topbar";
import { useAnalysis } from "./workbench/useAnalysis";
import { useLayout } from "./workbench/useLayout";
import { lensSources } from "./workbench/model-lens";
import { useModelLens } from "./workbench/useModelLens";
import { usePendingConsent } from "./workbench/usePendingConsent";
import { usePens } from "./workbench/usePens";
import { SharedBanner } from "./workbench/SharedBanner";
import { useServeLink } from "./workbench/useServeLink";
import { useSharedView } from "./workbench/useSharedView";
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
  const [signer, setSigner] = useSetting(SETTINGS.signer);
  /** The seal dialog is open for the active letter. */
  const [sealing, setSealing] = useState(false);
  /** "Save to folder…" was chosen: the Pages panel asks for a path. */
  const [saveRequest, setSaveRequest] = useState<{ name: PageName; slot: Slot } | null>(null);
  const sheetA = useRef<A4SheetHandle>(null);
  const sheetB = useRef<A4SheetHandle>(null);
  const handles = { a: sheetA, b: sheetB };

  const { setMode, setActive } = layout;
  // A share link's pages show read-only in place of the reader's own (see stage.ts).
  const sharedView = useSharedView(notify);
  useServeLink(lib.ready, lib.connectServed, notify);
  const stage = stageOf(lib.slots, layout, presetId, sharedView.view);
  const { shared, slots, compare, target, editable } = stage;
  const { ready } = lib;
  const { a: specA, b: specB } = stage.specs;
  /** Leave the shared view before a command that shows the reader's own pages. */
  const leaveShared = () => {
    if (shared) sharedView.close();
  };
  const spec = target === "a" ? specA : specB;
  const page = slots[target];
  const a = useAnalysis(slots.a.text, specA);
  const b = useAnalysis(slots.b.text, specB);
  const targetAnalysis = target === "a" ? a.analysis : b.analysis;
  const effectiveRender = gpuMissing ? "flat" : render;

  // Keep slot B open exactly while comparing (the reader's setting: a shared pair doesn't open one).
  const { ensureSlotB, closeSlotB, flushAll } = lib;
  const comparing = layout.compare;
  useEffect(() => {
    if (!ready) return;
    if (comparing) void ensureSlotB();
    else void closeSlotB();
  }, [ready, comparing, ensureSlotB, closeSlotB]);

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
  // The installed plugins with their publisher notes, for the lenses, the pens, and their dialogs.
  const installedPlugins = useMemo(
    () => models.installed.map((v) => ({ card: v.card, publisher: publisherNote(v.knownName, v.publisherName) })),
    [models.installed],
  );
  const lensCards = useMemo(() => {
    const ready = (card: ModelCard) => models.status.get(pluginIdOf(card)) === "ready";
    const runnable = models.sandbox !== "unavailable";
    return [
      ...(ready(SEMANTIC_REPETITION.card) ? [{ card: SEMANTIC_REPETITION.card, publisher: null }] : []),
      ...installedPlugins.filter((p) => runnable && ready(p.card)),
    ];
  }, [models.status, installedPlugins, models.sandbox]);
  const sources = useMemo(() => lensSources(lensCards), [lensCards]);
  const modelLens = useModelLens({
    models,
    notify,
    sources,
    texts: { a: slots.a.text, b: slots.b.text },
    specs: { a: specA, b: specB },
    compare,
    target,
    lens,
  });

  function chooseLens(id: LensId) {
    modelLens.off();
    setLens(id);
  }

  /** A card's "Show on the page": its first plane's lens. */
  function showPlugin(id: PluginId) {
    const source = sources.find((s) => s.pluginId === id);
    if (source) modelLens.show(source);
  }

  // The pens: one request each, owned here so it outlives the Models panel
  // (collapsing it, hiding the inspector, or focus mode don't stop it). A
  // result opens as B, beside its source as A.
  async function openPenResult(card: ModelCard, result: TransformResult, ref: PageRef | null) {
    // The dialog only opens for an open page, so a reference is always present.
    if (!ref) return;
    setMode("compare");
    if (!sameRef(slots.a.ref, ref)) {
      if (sameRef(slots.b.ref, ref)) await lib.swapSlots();
      else await lib.openInSlot("a", ref);
    }
    // Copies of folder files go to the library, named after the path.
    const name = await lib.createPage(copyNameFor(ref, penSuffix(card)), result.text, "b");
    setActive("b");
    if (!name) return;
    notify(
      result.fits
        ? `Created “${name}”: it fits in ${result.rowsUsed} of ${result.rowsAllowed} rows.`
        : `Created “${name}”, but it’s still over by ${result.overBy} rows after ${result.attempts} attempts.`,
      result.fits ? "info" : "warn",
    );
  }
  const pens = usePens({ host: models.host, installed: installedPlugins, spec, onResult: openPenResult });
  // The one consent dialog: the lens's pending score, else a pen's request.
  const consent = usePendingConsent(
    modelLens.consent
      ? {
          request: {
            card: modelLens.consent.source.card,
            publisher: modelLens.consent.source.publisher,
            pageName: slots[modelLens.consent.slot].label ?? "page",
            characters: modelLens.consent.text.length,
            action: "score",
          },
          send: () => void modelLens.send(),
          dismiss: modelLens.cancel,
        }
      : null,
    pens,
  );

  // --- Share links ---------------------------------------------------------

  /** Copy a link to the pages in `which` (one slot, or A then B): a sealed letter carries its seal. */
  async function copyShareLink(which: readonly Slot[]) {
    const specs = { a: specA, b: specB };
    try {
      const pages: SharePageInput[] = [];
      for (const slot of which) {
        const snapshot = slots[slot];
        const sealed = await lib.letterForShare(slot);
        const name = snapshot.ref?.kind === "file" ? baseName(snapshot.ref.path) : (snapshot.name ?? "Untitled");
        pages.push({
          name,
          preset: specs[slot].id,
          paper: specs[slot].paper,
          bytes: sealed?.bytes ?? new TextEncoder().encode(snapshot.text),
          ...(sealed ? { postmark: sealed.postmark } : {}),
        });
      }
      const link = await shareLink(pages, window.location.origin);
      await navigator.clipboard.writeText(link);
      notify(
        copiedNotice(
          pages.map((p) => p.name),
          link.length,
        ),
      );
    } catch (error) {
      if (error instanceof ShareError) notify(error.message, "warn");
      else notify(CLIPBOARD_BLOCKED, "warn");
    }
  }

  function selectLaterUnit(pair: FindingResult) {
    const later = pair.spans[pair.spans.length - 1];
    if (later) handles[target].current?.select(later.start, later.end);
  }

  // --- Page commands ---------------------------------------------------------

  /** Save a copy: each shared page becomes a library page under its own name (made unique), opened. */
  async function saveSharedCopy() {
    if (!shared) return;
    const pages = shared.pages;
    sharedView.close();
    if (pages.length === 2) setMode("compare");
    const saved: string[] = [];
    for (const [i, page] of pages.entries()) {
      const name = await lib.createPage(page.name.replace(/\.(md|mdc)$/i, ""), page.text, i === 0 ? "a" : "b");
      if (name) saved.push(`“${name}”`);
    }
    setActive("a");
    if (saved.length > 0) notify(`Saved ${saved.join(" and ")} to your library.`);
  }

  async function newPage(desired: string, text: string) {
    leaveShared();
    const name = await lib.createPage(desired, text, target);
    if (name) notify(`Created “${name}”.`);
  }

  async function loadPair(id: string) {
    leaveShared();
    const pair = SAMPLE_PAIRS.find((x) => x.id === id);
    if (!pair) return;
    setMode("compare");
    await lib.createPage("Incident (JSON)", pair.a, "a");
    await lib.createPage("Incident (narrative)", pair.b, "b");
  }

  function clearPage() {
    if (!editable || page.readOnly || !page.label || page.text === "") return;
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
    if (file.size > MAX_IMPORT_FILE_BYTES) {
      notify(
        `Couldn’t import “${file.name}”: files over ${formatByteLimit(MAX_IMPORT_FILE_BYTES)} aren’t supported.`,
        "warn",
      );
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
    leaveShared();
    setActive(slot);
    void lib.openInSlot(slot, ref, `open “${ref.kind === "file" ? ref.path : ref.name}”`).then(() => {
      if (layout.narrow) layout.setLibrary(false);
    });
  }

  /** Open a letter in B beside the letter before it in A, or on its own when it's the first. */
  async function openLetter(ref: PageRef) {
    if (ref.kind !== "file") return;
    leaveShared();
    const paths = lib.folder.letters.map((l) => l.path);
    const before = paths[paths.indexOf(ref.path) - 1];
    // The listed file for that path, whose path is already a checked FilePath.
    const previous = lib.folder.files.find((f) => f.path === before)?.path;
    if (!previous) {
      openInSlot(compare ? target : "a", ref);
      return;
    }
    setMode("compare");
    await lib.openInSlot("a", fileRef(previous), `open “${previous}”`);
    await lib.openInSlot("b", ref, `open “${ref.path}”`);
    setActive("b");
    if (layout.narrow) layout.setLibrary(false);
  }

  /** The active page's letter, when it is one. */
  const activePath = page.ref?.kind === "file" && isLetterPath(page.ref.path) ? page.ref.path : null;
  const activeLetter = activePath ? (lib.folder.letters.find((l) => l.path === activePath) ?? null) : null;

  async function seal(verdict: SealVerdict, reason: string, name: string): Promise<string | null> {
    const error = await lib.sealLetter(target, { verdict, reason, signer: name });
    if (error) return error;
    setSigner(name);
    setSealing(false);
    if (verdict === "accepted") {
      if (effectiveRender === "3d") handles[target].current?.fold();
      notify(`Sealed: accepted “${page.label ?? "the letter"}”.`);
    } else notify(`Sealed: returned “${page.label ?? "the letter"}”.`);
    return null;
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

  const libraryActions: LibraryActions = {
    switchTo: (kind) => void lib.switchLibrary(kind),
    connect: async (address, token) => {
      const connection = servedConnection(address, token);
      if (!connection) return badConnection(DEFAULT_SERVE_PORT);
      // The form checks the server first: if A4 can't use it, the form stays open and says why.
      const outcome = await lib.connectServed(connection, "form");
      if (outcome && !outcome.connected) return connectFailed(outcome.reason, connection.address, outcome.message);
      return null;
    },
    disconnect: () => void lib.disconnectServed(),
  };

  const folderActions: FolderActions = {
    pick: () => void lib.openFolder(),
    reconnect: () => void lib.reconnectFolder(),
    close: () => void lib.closeFolder(),
    createFile: (path) => lib.createFile(path, "", target),
    createLetter: () => lib.createLetter(TEMPLATES.find((t) => t.id === "handoff")?.text ?? "", target),
    openLetter: (ref) => void openLetter(ref),
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
  const legendShown = Boolean(modelLens.active) || lens !== "ink";

  // A letter in the active slot: a draft can be sealed; anything else shows its seal.
  let letterActions: ReactNode = null;
  if (activeLetter && (page.readOnly || activeLetter.state !== LetterState.DRAFT)) {
    letterActions = <SealedChip letter={activeLetter} />;
  } else if (activeLetter) {
    letterActions = (
      <button
        type="button"
        className="btn btn-outline"
        onClick={() => setSealing(true)}
        title="Accept or return this letter"
      >
        Seal…
      </button>
    );
  }

  return (
    <div className="app" data-focus={focus ? "" : undefined} data-print="flow">
      {!focus ? (
        <Topbar
          layout={stage.layout}
          title={<DocTitle page={page} folderName={folderName} onRename={lib.renamePage} />}
          pens={pens}
          lens={lens}
          modelLens={modelLens}
          onLens={chooseLens}
          verdict={targetAnalysis.assessment.verdict}
        >
          <PageMenu
            page={page}
            notify={notify}
            onNewPage={(desired, text) => void newPage(desired, text)}
            onLoadPair={(id) => void loadPair(id)}
            onClear={editable && !page.readOnly ? clearPage : null}
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
            onShare={
              page.ref
                ? {
                    page: () => void copyShareLink([target]),
                    pair: compare && slots.a.ref && slots.b.ref ? () => void copyShareLink(["a", "b"]) : null,
                  }
                : null
            }
          />
          <ViewMenu layout={layout} gpuMissing={gpuMissing} />
          <HelpMenu />
        </Topbar>
      ) : null}

      <div
        className={`workspace${showLibrary ? " with-library" : ""}${showInspector ? " with-inspector" : ""}`}
        data-print="flow"
      >
        {showLibrary ? (
          <LibraryPanel
            pages={lib.pages}
            trash={lib.trash}
            storage={lib.storage}
            served={lib.served}
            folder={lib.folder}
            open={{ a: slots.a.ref, b: compare ? slots.b.ref : null }}
            compare={compare}
            activeSlot={target}
            saveRequest={saveRequest}
            onOpen={(ref, slot) => openInSlot(slot, ref)}
            pageActions={pageActions}
            libraryActions={libraryActions}
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
          specs={{ a: specA, b: specB }}
          lens={modelLens.sheetLens}
          planes={modelLens.planes}
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
          onEdit={editable ? lib.edit : () => {}}
          onActivate={setActive}
          onRender={onSheetRender}
          deskActions={letterActions}
          notice={
            shared ? (
              <SharedBanner view={shared} onSave={() => void saveSharedCopy()} onClose={sharedView.close} />
            ) : null
          }
        >
          {legendShown && !focus ? (
            <figure className="lens-chip" aria-label="Lens legend" data-print="hide">
              <LensLegend lens={lens} model={modelLens.legend} />
              {modelLens.remoteStale ? (
                <button type="button" className="btn btn-outline" onClick={modelLens.rescore}>
                  Score again…
                </button>
              ) : null}
            </figure>
          ) : null}
          {focus ? (
            <div className="focus-bar" data-print="hide">
              {pens.map((pen) => (
                <PenJobChip key={pen.id} card={pen.card} job={pen.job} />
              ))}
              <button type="button" className="btn btn-outline focus-exit" onClick={() => layout.setFocus(false)}>
                Exit focus (Esc)
              </button>
            </div>
          ) : null}
        </SheetStage>

        {showInspector ? (
          <aside className="inspector" aria-label="Inspector" data-print="hide">
            <div className="inspector-head eyebrow">
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
                actions={
                  editable
                    ? {
                        swap: () => void lib.swapSlots(),
                        copyAToB: () => {
                          const ref = slots.a.ref;
                          if (ref) void lib.duplicatePage(ref, "copy page A into B", "b");
                        },
                      }
                    : null
                }
              />
            ) : (
              <MetricsPanel analysis={a.analysis} spec={specA} compress={a.compress} />
            )}
            <ModelsPanel
              models={models}
              activeLens={modelLens.active?.pluginId ?? null}
              onScore={showPlugin}
              notify={notify}
              slots={
                new Map<PluginId, ReactNode>([
                  ...pens.map(
                    (pen) =>
                      [
                        pen.id,
                        <PenPanel key={pen.id} pen={pen} page={{ name: page.label, ref: page.ref, text: page.text }} />,
                      ] as const,
                  ),
                  [
                    SEMANTIC_REPETITION.id,
                    modelLens.summary ? (
                      <SemanticSummaryView summary={modelLens.summary} onSelectPair={selectLaterUnit} />
                    ) : null,
                  ],
                ])
              }
            />
          </aside>
        ) : null}
      </div>

      <ConsentDialog
        request={consent?.request ?? null}
        onSend={() => consent?.send()}
        onCancel={() => consent?.dismiss()}
      />

      <SealDialog
        open={sealing && activeLetter !== null && !page.readOnly}
        letterName={activePath ? activePath.slice(activePath.lastIndexOf("/") + 1) : ""}
        overBy={targetAnalysis.metrics.overflow}
        signer={signer}
        onSeal={seal}
        onClose={() => setSealing(false)}
      />

      {toast ? (
        <div className="toast" role="status" data-tone={toast.tone} data-print="hide">
          {toast.message}
        </div>
      ) : null}
    </div>
  );
}
