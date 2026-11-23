"use client";

import { withPose, type Pose } from "@/lib/paper/deform";
import type { Slot } from "./useLibrary";

export interface SheetView {
  tilt: number;
  turn: number;
  light: number;
}

export const DEFAULT_VIEW: SheetView = { tilt: 32, turn: 0, light: 215 };

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}) {
  return (
    <label className="ctl-slider">
      <span>
        {label} <em>{format ? format(value) : value.toFixed(2)}</em>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

const deg = (v: number) => `${Math.round(v)}°`;

/** Fold/curl for the active sheet; tilt, turn, and light for every sheet. */
export function SheetControls({
  active,
  compare,
  pose,
  onPose,
  view,
  onView,
  onFold,
  onReset,
}: {
  active: Slot;
  compare: boolean;
  pose: Pose;
  onPose: (pose: Pose) => void;
  view: SheetView;
  onView: (view: SheetView) => void;
  onFold: () => void;
  onReset: () => void;
}) {
  return (
    <div className="sheet-controls" role="group" aria-label="3D controls">
      <div className="ctl-group">
        <span className="ctl-title">{compare ? `Sheet ${active.toUpperCase()}` : "Sheet"}</span>
        <button type="button" className="btn btn-outline" onClick={onFold}>
          ▶ Fold
        </button>
        <Slider label="Bottom fold" value={pose.foldBottom} min={0} max={1} step={0.01} onChange={(v) => onPose(withPose(pose, { foldBottom: v }))} />
        <Slider label="Top fold" value={pose.foldTop} min={0} max={1} step={0.01} onChange={(v) => onPose(withPose(pose, { foldTop: v }))} />
        <Slider label="Corner curl" value={pose.curl} min={0} max={1} step={0.01} onChange={(v) => onPose(withPose(pose, { curl: v }))} />
      </div>
      <div className="ctl-group">
        <span className="ctl-title">Camera</span>
        <Slider label="Tilt" value={view.tilt} min={0} max={65} step={1} format={deg} onChange={(v) => onView({ ...view, tilt: v })} />
        <Slider label="Turn" value={view.turn} min={-180} max={180} step={1} format={deg} onChange={(v) => onView({ ...view, turn: v })} />
        <Slider label="Light" value={view.light} min={0} max={360} step={1} format={deg} onChange={(v) => onView({ ...view, light: v })} />
        <button type="button" className="btn btn-outline" onClick={onReset}>
          Reset
        </button>
      </div>
    </div>
  );
}
