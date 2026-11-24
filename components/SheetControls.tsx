"use client";

import { ATTRIBUTES, type NumberAttribute, withPose, type Pose } from "@/lib/render";
import type { Slot } from "@/lib/workspace";

export interface SheetView {
  tilt: number;
  turn: number;
  light: number;
}

export const DEFAULT_VIEW: SheetView = {
  tilt: ATTRIBUTES.tilt.default,
  turn: ATTRIBUTES.turn.default,
  light: ATTRIBUTES.light.default,
};

/** A slider's range and step, from the element's attribute table. */
function range({ min, max, step }: NumberAttribute) {
  return { min, max, step };
}

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
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
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
        <span className="ctl-title eyebrow">{compare ? `Sheet ${active.toUpperCase()}` : "Sheet"}</span>
        <button type="button" className="btn btn-outline" onClick={onFold}>
          ▶ Fold
        </button>
        <Slider
          label="Bottom fold"
          value={pose.foldBottom}
          {...range(ATTRIBUTES.foldBottom)}
          onChange={(v) => onPose(withPose(pose, { foldBottom: v }))}
        />
        <Slider
          label="Top fold"
          value={pose.foldTop}
          {...range(ATTRIBUTES.foldTop)}
          onChange={(v) => onPose(withPose(pose, { foldTop: v }))}
        />
        <Slider
          label="Corner curl"
          value={pose.curl}
          {...range(ATTRIBUTES.curl)}
          onChange={(v) => onPose(withPose(pose, { curl: v }))}
        />
      </div>
      <div className="ctl-group">
        <span className="ctl-title eyebrow">Camera</span>
        <Slider
          label="Tilt"
          value={view.tilt}
          {...range(ATTRIBUTES.tilt)}
          format={deg}
          onChange={(v) => onView({ ...view, tilt: v })}
        />
        <Slider
          label="Turn"
          value={view.turn}
          {...range(ATTRIBUTES.turn)}
          format={deg}
          onChange={(v) => onView({ ...view, turn: v })}
        />
        <Slider
          label="Light"
          value={view.light}
          {...range(ATTRIBUTES.light)}
          format={deg}
          onChange={(v) => onView({ ...view, light: v })}
        />
        <button type="button" className="btn btn-outline" onClick={onReset}>
          Reset
        </button>
      </div>
    </div>
  );
}
