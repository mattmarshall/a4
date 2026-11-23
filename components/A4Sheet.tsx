"use client";

/**
 * React wrapper for the <a4-sheet> custom element. Defines the element on the
 * client (it can't be evaluated during server rendering), mirrors props to
 * attributes, sets `value` only when it differs, and forwards events.
 */

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { A4Plane, A4Render, A4RenderRequest, A4SheetElement } from "@/lib/element/a4-sheet";
import type { LensId } from "@/lib/lenses";
import type { PresetId } from "@/lib/page-spec";
import type { Pose } from "@/lib/paper/deform";

export interface A4SheetHandle {
  element(): A4SheetElement | null;
  focus(): void;
  fold(): void;
}

export interface A4SheetProps {
  value: string;
  onValue: (value: string) => void;
  preset: PresetId;
  /** A built-in lens, or `model:<name>` to show the plane named `name`. */
  lens: LensId | `model:${string}`;
  /** Model planes by name, shown with `lens="model:<name>"`. */
  planes?: Readonly<Record<string, A4Plane>>;
  render: A4RenderRequest;
  pose: Pose;
  tilt: number;
  turn: number;
  light: number;
  /** CSS px per mm, or null to fit. */
  zoom: number | null;
  grid: boolean;
  label: string;
  className?: string;
  onFocus?: () => void;
  onRender?: (render: A4Render) => void;
  onViewChange?: (view: { tilt: number; turn: number }) => void;
  onPoseChange?: (pose: Pose) => void;
}

let defining: Promise<void> | null = null;
function ensureDefined(): Promise<void> {
  defining ??= import("@/lib/element/a4-sheet").then((m) => m.defineA4Sheet());
  return defining;
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
    const onRender = (e: Event) => latest.current.onRender?.((e as CustomEvent<A4Render>).detail);
    const onView = (e: Event) => latest.current.onViewChange?.((e as CustomEvent<{ tilt: number; turn: number }>).detail);
    const onPose = (e: Event) => latest.current.onPoseChange?.((e as CustomEvent<Pose>).detail);
    el.addEventListener("input", onInput);
    el.addEventListener("a4-focus", onFocus);
    // Any press on the sheet (typing target, drag, or orbit) also makes it active.
    el.addEventListener("pointerdown", onFocus);
    el.addEventListener("a4-render", onRender);
    el.addEventListener("a4-viewchange", onView);
    el.addEventListener("a4-posechange", onPose);
    return () => {
      el.removeEventListener("input", onInput);
      el.removeEventListener("a4-focus", onFocus);
      el.removeEventListener("pointerdown", onFocus);
      el.removeEventListener("a4-render", onRender);
      el.removeEventListener("a4-viewchange", onView);
      el.removeEventListener("a4-posechange", onPose);
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
      syncPlanes(el);
    });
    return () => {
      cancelled = true;
    };
  }, [planes]);

  function syncPlanes(el: A4SheetElement) {
    const next = planes ?? {};
    for (const [name, plane] of Object.entries(next)) {
      if (shownPlanes.current.get(name) === plane) continue;
      try {
        el.setPlane(name, plane);
        shownPlanes.current.set(name, plane);
      } catch {
        // A plane for another preset: leave it off rather than crash the page.
      }
    }
    for (const name of [...shownPlanes.current.keys()]) {
      if (!(name in next)) {
        el.removePlane(name);
        shownPlanes.current.delete(name);
      }
    }
  }

  // Attributes.
  const { preset, lens, render, pose, tilt, turn, light, zoom, grid, label } = props;
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const attrs: Record<string, string | null> = {
      preset,
      lens,
      render,
      "fold-bottom": String(pose.foldBottom),
      "fold-top": String(pose.foldTop),
      curl: String(pose.curl),
      tilt: String(tilt),
      turn: String(turn),
      light: String(light),
      zoom: zoom === null ? "fit" : String(zoom),
      grid: grid ? "" : null,
      label,
    };
    for (const [name, value] of Object.entries(attrs)) {
      if (value === null) el.removeAttribute(name);
      else if (el.getAttribute(name) !== value) el.setAttribute(name, value);
    }
  }, [preset, lens, render, pose, tilt, turn, light, zoom, grid, label]);

  return <a4-sheet ref={host} class={props.className} />;
});
