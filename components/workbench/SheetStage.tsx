"use client";

/**
 * The desk: the open sheets (with captions and slot pickers in Compare), the
 * desk tools, and the pose panel. Pose and camera (fold, curl, tilt, turn,
 * light) are state of this component alone, so orbiting or folding a sheet
 * re-renders only the stage, never the library or the inspector.
 */

import { useState, type CSSProperties, type ReactNode, type RefCallback, type RefObject } from "react";
import type { Analysis } from "@/lib/analysis";
import { type A4Plane, type LensAttr, FLAT, type Pose } from "@/lib/render";
import type { PageSpec } from "@/lib/page";
import { decodeRef, encodeRef, libraryRef, type PageRef, type PageSummary } from "@/lib/persist";
import type { FolderSnapshot, Slot, SlotSnapshot } from "@/lib/workspace";
import { A4Sheet, type A4SheetHandle } from "../A4Sheet";
import { VERDICT_LABEL } from "../analysis-copy";
import { DEFAULT_VIEW, SheetControls, type SheetView } from "../SheetControls";
import { SaveStatusPill } from "./SaveStatusPill";

type Render = "3d" | "flat";

function SlotPicker({
  slot,
  current,
  pages,
  folder,
  onOpen,
}: {
  slot: Slot;
  current: PageRef | null;
  pages: readonly PageSummary[];
  folder: FolderSnapshot;
  onOpen: (slot: Slot, ref: PageRef) => void;
}) {
  const files = folder.state.status === "connected" ? folder.files.filter((f) => !f.unreadable) : [];
  return (
    <select
      className="select slot-select"
      aria-label={`Page in slot ${slot.toUpperCase()}`}
      value={encodeRef(current)}
      onChange={(e) => {
        const ref = decodeRef(e.target.value);
        if (ref) onOpen(slot, ref);
      }}
    >
      <optgroup label="Library">
        {pages.map((p) => (
          <option key={p.name} value={encodeRef(libraryRef(p.name))}>
            {p.name}
          </option>
        ))}
      </optgroup>
      {files.length ? (
        <optgroup label={folder.state.status === "connected" ? folder.state.name : "Folder"}>
          {files.map((f) => (
            <option key={f.path} value={encodeRef({ kind: "file", path: f.path })}>
              {f.path}
            </option>
          ))}
        </optgroup>
      ) : null}
    </select>
  );
}

export interface SheetStageProps {
  /** Handles to the sheets, for focus, selection, and the fold. */
  handles: Readonly<Record<Slot, RefObject<A4SheetHandle | null>>>;
  slots: Readonly<Record<Slot, SlotSnapshot>>;
  analyses: Readonly<Record<Slot, Analysis>>;
  compare: boolean;
  /** The slot the pose panel and the desk tools act on. */
  target: Slot;
  /** Storage is open: sheets show once their page is. */
  ready: boolean;
  failure: string | null;
  spec: PageSpec;
  lens: LensAttr;
  planes: Readonly<Record<Slot, Readonly<Record<string, A4Plane>> | undefined>>;
  render: Render;
  /** CSS px per mm, or null to let the 3D stage fit. */
  zoom: number | null;
  grid: boolean;
  /** What the slot pickers list. */
  pages: readonly PageSummary[];
  folder: FolderSnapshot;
  deskRef: RefCallback<HTMLDivElement>;
  stageHeight: number;
  focus: boolean;
  posePanel: boolean;
  onPosePanel: (open: boolean) => void;
  onOpen: (slot: Slot, ref: PageRef) => void;
  onEdit: (slot: Slot, text: string) => void;
  onActivate: (slot: Slot) => void;
  onRender: (render: Render) => void;
  /** Shown over the desk (the lens legend, the focus bar). */
  children?: ReactNode;
}

export function SheetStage(props: SheetStageProps) {
  const { handles, slots, analyses, compare, target, spec, render, focus, posePanel, onPosePanel } = props;
  const [poses, setPoses] = useState<Record<Slot, Pose>>({ a: FLAT, b: FLAT });
  const [view, setView] = useState<SheetView>(DEFAULT_VIEW);
  const shown: readonly Slot[] = compare ? ["a", "b"] : ["a"];
  const fold = () => handles[target].current?.fold();
  const sheetsStyle = { "--a4-3d-height": `${props.stageHeight}px` } as CSSProperties;

  return (
    <main className="desk-frame" data-print="flow">
      <div className="desk" ref={props.deskRef} data-print="flow">
        {props.failure ? (
          <div className="banner" role="alert" data-print="hide">
            Couldn’t open page storage: {props.failure}
          </div>
        ) : null}
        <div className={`sheets render-${render}`} style={sheetsStyle} data-print="flow">
          {shown.map((slot) => {
            const state = slots[slot];
            const analysis = analyses[slot];
            return (
              <div
                key={slot}
                className="sheet-col"
                data-active={compare && target === slot ? "" : undefined}
                data-print="flow"
              >
                {compare ? (
                  <div className="sheet-caption" data-print="hide">
                    <b>{slot.toUpperCase()}</b>
                    <SlotPicker
                      slot={slot}
                      current={state.ref}
                      pages={props.pages}
                      folder={props.folder}
                      onOpen={props.onOpen}
                    />
                    <SaveStatusPill status={state.status} />
                    <span>
                      {VERDICT_LABEL[analysis.assessment.verdict]} · ≈{analysis.metrics.tokens.toLocaleString("en-US")}{" "}
                      tokens
                    </span>
                  </div>
                ) : null}
                <A4Sheet
                  ref={handles[slot]}
                  className={!props.ready || !state.ref ? "sheet-hidden" : undefined}
                  value={state.text}
                  onValue={(text) => props.onEdit(slot, text)}
                  onFocus={() => props.onActivate(slot)}
                  onRender={props.onRender}
                  onViewChange={({ tilt, turn }) => setView((v) => ({ ...v, tilt, turn }))}
                  onPoseChange={(pose) => setPoses((p) => ({ ...p, [slot]: pose }))}
                  preset={spec.id}
                  lens={props.lens}
                  planes={props.planes[slot]}
                  render={render}
                  pose={poses[slot]}
                  tilt={view.tilt}
                  turn={view.turn}
                  light={view.light}
                  zoom={props.zoom}
                  grid={props.grid}
                  label={`${state.label ?? `Page ${slot.toUpperCase()}`}: A4 page, ${spec.cols} columns by ${spec.rows} rows`}
                />
              </div>
            );
          })}
        </div>
      </div>

      {render === "3d" && !focus ? (
        <div className="desk-tools" data-print="hide">
          <button type="button" className="btn btn-outline" onClick={fold} title="Play the letter fold">
            ▶ Fold
          </button>
          <button
            type="button"
            className="btn btn-outline"
            aria-pressed={posePanel}
            aria-expanded={posePanel}
            onClick={() => onPosePanel(!posePanel)}
            title="Fold, curl, tilt, turn, and light"
          >
            Pose…
          </button>
        </div>
      ) : null}

      {posePanel && render === "3d" && !focus ? (
        <div className="pose-panel" role="dialog" aria-label="Pose and camera" data-print="hide">
          <button
            type="button"
            className="btn pose-close"
            onClick={() => onPosePanel(false)}
            aria-label="Close pose and camera"
          >
            ×
          </button>
          <SheetControls
            active={target}
            compare={compare}
            pose={poses[target]}
            onPose={(pose) => setPoses((p) => ({ ...p, [target]: pose }))}
            view={view}
            onView={setView}
            onFold={fold}
            onReset={() => {
              setPoses({ a: FLAT, b: FLAT });
              setView(DEFAULT_VIEW);
            }}
          />
        </div>
      ) : null}

      {props.children}
    </main>
  );
}
