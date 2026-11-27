"use client";

/**
 * The top bar: the Pages toggle, the open page's name and save status, the
 * lens, Single or Compare, zoom, the menus (passed as children), and the
 * Inspector toggle.
 */

import Link from "next/link";
import { useEffect, useState, type KeyboardEvent, type ReactNode } from "react";
import { LENSES, type VerdictId } from "@/lib/analysis";
import { remoteHost, SEMANTIC_REPETITION } from "@/lib/models";
import type { LensId } from "@/lib/page";
import type { PageName } from "@/lib/persist";
import type { SlotSnapshot } from "@/lib/workspace";
import { PenJobChip } from "../PenPanel";
import { VerdictChip } from "../MetricsPanel";
import { SaveStatusPill } from "./SaveStatusPill";
import type { Layout } from "./useLayout";
import { planeKey, type LensSource } from "./model-lens";
import type { Pen } from "./usePens";
import type { ModelLens } from "./useModelLens";

function PageNameField({
  name,
  onRename,
}: {
  name: PageName | null;
  onRename: (input: string) => Promise<string | null>;
}) {
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
  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") e.currentTarget.blur();
    if (e.key === "Escape") {
      e.preventDefault();
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

/** A model lens button's title: what the plane shows, who made it, and where it runs. */
function lensTitle(source: LensSource): string {
  if (source.pluginId === SEMANTIC_REPETITION.id) {
    return "Model lens: sentences and fields that restate one another (runs in your browser)";
  }
  const host = remoteHost(source.card);
  const where = host === null ? "runs in your browser" : `sends the page to ${host} after you confirm`;
  return `Model lens: ${source.label}, from ${source.card.name}${source.publisher ? ` · ${source.publisher}` : ""} (${where})`;
}

/** The open page's name (editable for library pages) or file path, and its save status. */
export function DocTitle({
  page,
  folderName,
  onRename,
}: {
  page: SlotSnapshot;
  folderName: string;
  onRename: (from: PageName, input: string) => Promise<string | null>;
}) {
  if (page.ref === null && page.label !== null) {
    // A shared page: not one of the reader's, so it has no name to edit and no save status.
    return (
      <div className="doc-title">
        <span className="file-title" title={page.label}>
          <span className="file-path">{page.label}</span>
        </span>
        <span className="save-pill" data-status="shared">
          Shared · not saved
        </span>
      </div>
    );
  }
  return (
    <div className="doc-title">
      {page.ref?.kind === "file" ? (
        <span className="file-title" title={`${folderName} / ${page.ref.path}`}>
          <span className="file-folder">{folderName}</span>
          <span className="file-path">{page.ref.path}</span>
        </span>
      ) : (
        <PageNameField name={page.name} onRename={async (input) => (page.name ? onRename(page.name, input) : null)} />
      )}
      <SaveStatusPill status={page.status} compact />
    </div>
  );
}

export function Topbar({
  layout,
  title,
  pens,
  lens,
  modelLens,
  onLens,
  verdict,
  children,
}: {
  layout: Layout;
  title: ReactNode;
  /** Every pen: a running one shows its progress and Cancel. */
  pens: readonly Pen[];
  lens: LensId;
  modelLens: ModelLens;
  onLens: (id: LensId) => void;
  /** The target page's verdict, shown while the inspector is hidden. */
  verdict: VerdictId;
  /** The menus. */
  children: ReactNode;
}) {
  const { zoom } = layout;
  return (
    <header className="topbar" data-print="hide">
      <Link href="/" className="brand" aria-label="A4 home">
        <span className="brand-mark">A4</span>
      </Link>

      <div className="toolbar" role="toolbar" aria-label="Page controls">
        <button
          type="button"
          className="btn btn-outline"
          aria-pressed={layout.library}
          onClick={() => layout.setLibrary(!layout.library)}
          title="Show or hide the page library"
        >
          <span aria-hidden="true">☰</span>
          <span className="visually-hidden-medium">Pages</span>
        </button>

        {title}

        {pens.map((pen) => (
          <PenJobChip key={pen.id} card={pen.card} job={pen.job} />
        ))}

        <span className="spacer" />

        <fieldset className="seg" aria-label="Lens">
          {LENSES.map((l) => (
            <button
              key={l.id}
              type="button"
              aria-pressed={!modelLens.active && lens === l.id}
              title={l.hint}
              onClick={() => onLens(l.id)}
            >
              {l.name}
            </button>
          ))}
          {modelLens.sources.map((source) => {
            const key = planeKey(source.pluginId, source.plane);
            const on = modelLens.active !== null && planeKey(modelLens.active.pluginId, modelLens.active.plane) === key;
            return (
              <button
                key={key}
                type="button"
                className="lens-model"
                aria-pressed={on}
                title={lensTitle(source)}
                onClick={() => modelLens.show(source)}
              >
                {source.pluginId === SEMANTIC_REPETITION.id ? "Semantic" : source.label}
              </button>
            );
          })}
        </fieldset>

        <fieldset className="seg" aria-label="View">
          <button type="button" aria-pressed={layout.mode === "single"} onClick={() => layout.setMode("single")}>
            Single
          </button>
          <button type="button" aria-pressed={layout.mode === "compare"} onClick={() => layout.setMode("compare")}>
            Compare
          </button>
        </fieldset>

        <fieldset className="tool-group zoom" aria-label="Zoom">
          <button type="button" className="btn" onClick={() => layout.stepZoom(-1)} aria-label="Zoom out">
            −
          </button>
          <button
            type="button"
            className="btn zoom-value"
            aria-live="polite"
            title={zoom.kind === "fit" ? "Fitting the page to the desk" : "Fit the page to the desk"}
            onClick={() => layout.setZoom({ kind: "fit" })}
          >
            {layout.zoomPct}%
          </button>
          <button type="button" className="btn" onClick={() => layout.stepZoom(1)} aria-label="Zoom in">
            +
          </button>
        </fieldset>

        {children}

        {!layout.inspector ? <VerdictChip verdict={verdict} /> : null}
        <button
          type="button"
          className="btn btn-outline"
          aria-pressed={layout.inspector}
          onClick={() => layout.setInspector(!layout.inspector)}
          title="Show or hide the inspector"
        >
          Inspector
        </button>
      </div>
    </header>
  );
}
