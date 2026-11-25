"use client";

/**
 * React wrapper for the <a4-sheet> custom element. Defines the element on the
 * client (it can't be evaluated during server rendering), mirrors props to
 * attributes, sets `value` only when it differs, and forwards events.
 *
 * Attributes are requested values: after the user orbits or folds, the sheet
 * shows something else, and writing a prop's value again resets it. So a
 * prop is written whenever it differs from what this wrapper last wrote, not
 * from the element's current attribute (sheet-sync.ts).
 */

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { PaperId, PresetId } from "@/lib/page";
import {
  A4_EVENTS,
  defineSheetElement,
  toAttributes,
  type A4AttributeName,
  type A4Plane,
  type A4Render,
  type A4RenderRequest,
  type A4SheetElement,
  type A4ViewChange,
  type LensAttr,
  type Pose,
} from "@/lib/render";
import { attributeWrites, diffPlanes } from "./sheet-sync";

/** What the page can ask of a sheet; each call waits until the element is defined. */
export interface A4SheetHandle {
  focus(): void;
  /** Focus the sheet and select [start, end) of its text. */
  select(start: number, end: number): void;
  /** Play the letter fold. */
  fold(): void;
}

export interface A4SheetProps {
  value: string;
  onValue: (value: string) => void;
  preset: PresetId;
  /** The paper, down the fold ladder (default A4). */
  size?: PaperId | undefined;
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
  /** Stop editing (a sealed letter); selecting and copying still work. */
  readOnly?: boolean | undefined;
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
  const { set, remove } = diffPlanes(planes, shown);
  for (const [name, plane] of set) {
    try {
      el.setPlane(name, plane);
      shown.set(name, plane);
    } catch {
      // A plane for another preset: leave it off rather than crash the page.
    }
  }
  for (const name of remove) {
    el.removePlane(name);
    shown.delete(name);
  }
}

export const A4Sheet = forwardRef<A4SheetHandle, A4SheetProps>(function A4Sheet(props, ref) {
  const host = useRef<A4SheetElement | null>(null);
  const latest = useRef(props);
  latest.current = props;

  useImperativeHandle(ref, () => {
    /** Run `act` on the element once it is defined (calls before then would hit a plain element). */
    const whenDefined = (act: (el: A4SheetElement) => void) => {
      void ensureDefined().then(() => {
        const el = host.current;
        if (el) act(el);
      });
    };
    return {
      focus: () => whenDefined((el) => el.focus()),
      select: (start, end) =>
        whenDefined((el) => {
          el.focus();
          el.setSelectionRange(start, end);
        }),
      fold: () => whenDefined((el) => el.fold()),
    };
  }, []);

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

  // Attributes: each prop that changed since this wrapper last wrote it.
  const written = useRef(new Map<A4AttributeName, string | null>());
  const { preset, lens, render, pose, tilt, turn, light, zoom, grid, label } = props;
  const readOnly = props.readOnly ?? false;
  const size = props.size ?? "a4";
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const attrs = toAttributes({
      preset,
      size,
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
      readOnly,
    });
    for (const [name, value] of attributeWrites(attrs, written.current)) {
      if (value === null) el.removeAttribute(name);
      else el.setAttribute(name, value);
      written.current.set(name, value);
    }
  }, [preset, size, lens, render, pose, tilt, turn, light, zoom, grid, label, readOnly]);

  return <a4-sheet ref={host} class={props.className} />;
});
