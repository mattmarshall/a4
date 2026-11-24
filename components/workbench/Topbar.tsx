"use client";

/**
 * The top bar: the Pages toggle, the open page's name and save status, the
 * lens, Single or Compare, zoom, the menus (passed as children), and the
 * Inspector toggle.
 */

import Link from "next/link";
import { useEffect, useState, type KeyboardEvent, type ReactNode } from "react";
import { LENSES, type VerdictId } from "@/lib/analysis";
import { type FitJob, SEMANTIC_REPETITION_ID } from "@/lib/models";
import type { LensId } from "@/lib/page";
import type { PageName, PageRef } from "@/lib/persist";
import type { SlotSnapshot } from "@/lib/workspace";
import { FitJobChip } from "../FitToPage";
import { VerdictChip } from "../MetricsPanel";
import { SaveStatusPill } from "./SaveStatusPill";
import type { Layout } from "./useLayout";
import type { SemanticLens } from "./useSemanticLens";

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
      <SaveStatusPill status={page.status} />
    </div>
  );
}

export function Topbar({
  layout,
  title,
  fitJob,
  lens,
  semantic,
  onLens,
  verdict,
  children,
}: {
  layout: Layout;
  title: ReactNode;
  fitJob: FitJob<PageRef>;
  lens: LensId;
  semantic: SemanticLens;
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
          <span className="btn-label">Pages</span>
        </button>

        {title}

        <FitJobChip job={fitJob} />

        <span className="spacer" />

        <div className="seg" role="group" aria-label="Lens">
          {LENSES.map((l) => (
            <button
              key={l.id}
              type="button"
              aria-pressed={!semantic.active && lens === l.id}
              title={l.hint}
              onClick={() => onLens(l.id)}
            >
              {l.name}
            </button>
          ))}
          {semantic.available ? (
            <button
              type="button"
              className="lens-model"
              aria-pressed={semantic.active === SEMANTIC_REPETITION_ID}
              title="Model lens: sentences and fields that restate one another (runs in your browser)"
              onClick={semantic.show}
            >
              Semantic
            </button>
          ) : null}
        </div>

        <div className="seg" role="group" aria-label="View">
          <button type="button" aria-pressed={layout.mode === "single"} onClick={() => layout.setMode("single")}>
            Single
          </button>
          <button type="button" aria-pressed={layout.mode === "compare"} onClick={() => layout.setMode("compare")}>
            Compare
          </button>
        </div>

        <div className="tool-group zoom" role="group" aria-label="Zoom">
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
        </div>

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
