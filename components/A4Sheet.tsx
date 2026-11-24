"use client";

/**
 * React wrapper for the <a4-sheet> custom element. Defines the element on the
 * client (it can't be evaluated during server rendering), mirrors props to
 * attributes, sets `value` only when it differs, and forwards events.
 */

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { PresetId } from "@/lib/page";
import {
  A4_EVENTS,
  defineSheetElement,
  toAttributes,
  type A4Plane,
  type A4Render,
  type A4RenderRequest,
  type A4SheetElement,
  type A4ViewChange,
  type LensAttr,
  type Pose,
} from "@/lib/render";

export interface A4SheetHandle {
  element(): A4SheetElement | null;
  focus(): void;
  fold(): void;
}

export interface A4SheetProps {
  value: string;
  onValue: (value: string) => void;
  preset: PresetId;
  /** A built-in lens, or `modelLens(name)` to show the plane named `name`. */
  lens: LensAttr;
  /** Model planes by name, shown with `lens="model:<name>"`. */
  planes?: Readonly<Record<string, A4Plane>> | undefined;
  render: A4RenderRequest;
  pose: Pose;
  tilt: number;
  turn: number;
  light: number;
  /** CSS px per mm, or null to fit. */
  zoom: number | null;
  grid: boolean;
  label: string;
  className?: string | undefined;
  onFocus?: () => void;
  onRender?: (render: A4Render) => void;
  onViewChange?: (view: A4ViewChange) => void;
  onPoseChange?: (pose: Pose) => void;
}

let defining: Promise<void> | null = null;
function ensureDefined(): Promise<void> {
  defining ??= defineSheetElement();
  return defining;
}

function syncPlanes(
  el: A4SheetElement,
  planes: Readonly<Record<string, A4Plane>> | undefined,
  shown: Map<string, A4Plane>,
) {
  const next = planes ?? {};
  for (const [name, plane] of Object.entries(next)) {
    if (shown.get(name) === plane) continue;
    try {
      el.setPlane(name, plane);
      shown.set(name, plane);
    } catch {
      // A plane for another preset: leave it off rather than crash the page.
    }
  }
  for (const name of [...shown.keys()]) {
    if (!(name in next)) {
      el.removePlane(name);
      shown.delete(name);
    }
  }
}

export const A4Sheet = forwardRef<A4SheetHandle, A4SheetProps>(function A4Sheet(props, ref) {
  const host = useRef<A4SheetElement | null>(null);
  const latest = useRef(props);
  latest.current = props;

  useImperativeHandle(ref, () => ({
    element: () => host.current,
    focus: () => host.current?.focus(),
    fold: () => host.current?.fold(),
  }));

  useEffect(() => {
    void ensureDefined();
  }, []);

  // Events (read callbacks through a ref so listeners are attached once).
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const onInput = () => latest.current.onValue(el.value);
    const onFocus = () => latest.current.onFocus?.();
    const onRender = (e: CustomEvent<A4Render>) => latest.current.onRender?.(e.detail);
    const onView = (e: CustomEvent<A4ViewChange>) => latest.current.onViewChange?.(e.detail);
    const onPose = (e: CustomEvent<Pose>) => latest.current.onPoseChange?.(e.detail);
    el.addEventListener("input", onInput);
    el.addEventListener(A4_EVENTS.focus, onFocus);
    // Any press on the sheet (typing target, drag, or orbit) also makes it active.
    el.addEventListener("pointerdown", onFocus);
    el.addEventListener(A4_EVENTS.render, onRender);
    el.addEventListener(A4_EVENTS.viewChange, onView);
    el.addEventListener(A4_EVENTS.poseChange, onPose);
    return () => {
      el.removeEventListener("input", onInput);
      el.removeEventListener(A4_EVENTS.focus, onFocus);
      el.removeEventListener("pointerdown", onFocus);
      el.removeEventListener(A4_EVENTS.render, onRender);
      el.removeEventListener(A4_EVENTS.viewChange, onView);
      el.removeEventListener(A4_EVENTS.poseChange, onPose);
    };
  }, []);

  // Value: only when it differs, so the caret stays put while typing.
  useEffect(() => {
    const el = host.current;
    if (el && el.value !== props.value) el.value = props.value;
  }, [props.value]);

  // Planes: set new or changed ones (by identity), remove ones that are gone.
  const shownPlanes = useRef(new Map<string, A4Plane>());
  const { planes } = props;
  useEffect(() => {
    let cancelled = false;
    void ensureDefined().then(() => {
      const el = host.current;
      if (cancelled || !el) return;
      syncPlanes(el, planes, shownPlanes.current);
    });
    return () => {
      cancelled = true;
    };
  }, [planes]);

  // Attributes.
  const { preset, lens, render, pose, tilt, turn, light, zoom, grid, label } = props;
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const attrs = toAttributes({
      preset,
      lens,
      render,
      foldBottom: pose.foldBottom,
      foldTop: pose.foldTop,
      curl: pose.curl,
      tilt,
      turn,
      light,
      zoom,
      grid,
      label,
    });
    for (const [name, value] of attrs) {
      if (value === null) el.removeAttribute(name);
      else if (el.getAttribute(name) !== value) el.setAttribute(name, value);
    }
  }, [preset, lens, render, pose, tilt, turn, light, zoom, grid, label]);

  return <a4-sheet ref={host} class={props.className} />;
});
