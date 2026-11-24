"use client";

/**
 * The Workbench's layout: Single or Compare, which slot is active, the side
 * panels, focus mode, the pose panel, and zoom. Mode and panels are settings;
 * the rest lasts for the visit. Panels the author hasn't toggled follow the
 * window width (open on wide windows).
 */

import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { fitScale, PX_PER_MM_ACTUAL } from "@/lib/page";
import { readSetting, SETTINGS, subscribeSettings, writeSetting, type Mode, type Setting } from "@/lib/persist";
import type { Slot } from "@/lib/workspace";
import { useSetting } from "../useSetting";

export type Zoom = { readonly kind: "fit" } | { readonly kind: "fixed"; readonly mm: number };

const ZOOM_STEPS = [0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
const MIN_MM = 1.2;
/** Below this width the side panels cover the desk. */
const NARROW = "(max-width: 1099px)";
/** Height the captions take above each sheet in Compare. */
const CAPTION_HEIGHT = 40;
/** Gap between the sheets in Compare. */
const SHEET_GAP = 28;

function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** A side panel: the author's choice, or open on wide windows until they choose. */
function usePanel(setting: Setting<boolean>, narrow: boolean): [boolean, (open: boolean) => void] {
  const read = useCallback(() => readSetting(setting), [setting]);
  const stored = useSyncExternalStore(subscribeSettings, read, () => null);
  const set = useCallback((open: boolean) => writeSetting(setting, open), [setting]);
  return [stored ?? !narrow, set];
}

export function useLayout() {
  const narrow = useMediaQuery(NARROW);
  const [mode, storeMode] = useSetting(SETTINGS.mode);
  const [library, setLibrary] = usePanel(SETTINGS.pagesPanel, narrow);
  const [inspector, setInspector] = usePanel(SETTINGS.inspector, narrow);
  const [active, setActive] = useState<Slot>("a");
  const [focus, setFocus] = useState(false);
  const [posePanel, setPosePanel] = useState(false);
  const [zoom, setZoom] = useState<Zoom>({ kind: "fit" });
  const [desk, setDesk] = useState({ width: 0, height: 0 });

  /** Measures the desk: the page fits both its width and its height. */
  const deskRef = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setDesk({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const compare = mode === "compare";
  const captionHeight = compare ? CAPTION_HEIGHT : 0;
  const fitMm = useMemo(() => {
    if (!desk.width || !desk.height) return PX_PER_MM_ACTUAL;
    return fitScale(
      { width: desk.width, height: desk.height - captionHeight },
      { pages: compare ? 2 : 1, gap: SHEET_GAP, min: MIN_MM },
    );
  }, [desk.width, desk.height, compare, captionHeight]);
  const mm = zoom.kind === "fit" ? fitMm : zoom.mm;

  /** Switch between Single and Compare. The page refits; Single shows A. */
  const setMode = useCallback(
    (next: Mode) => {
      storeMode(next);
      setZoom({ kind: "fit" });
      if (next !== "compare") setActive("a");
    },
    [storeMode],
  );

  const stepZoom = useCallback(
    (dir: 1 | -1) => {
      const current = mm / PX_PER_MM_ACTUAL;
      const next =
        dir > 0
          ? (ZOOM_STEPS.find((s) => s > current + 0.001) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1])
          : ([...ZOOM_STEPS].reverse().find((s) => s < current - 0.001) ?? ZOOM_STEPS[0]);
      setZoom({ kind: "fixed", mm: (next ?? 1) * PX_PER_MM_ACTUAL });
    },
    [mm],
  );

  /** Esc: close the pose panel, then leave focus mode. */
  const dismiss = useCallback(() => {
    if (posePanel) setPosePanel(false);
    else setFocus(false);
  }, [posePanel]);

  return {
    mode,
    compare,
    setMode,
    /** The slot the top bar, menus, and inspector act on. */
    target: compare ? active : ("a" as Slot),
    setActive,
    /** Side panels cover the desk, so opening a page closes the library. */
    narrow,
    library,
    setLibrary,
    inspector,
    setInspector,
    focus,
    setFocus,
    posePanel,
    setPosePanel,
    dismiss,
    zoom,
    setZoom,
    stepZoom,
    /** CSS px per mm the sheets are shown at. */
    mm,
    /**
     * The zoom to give the sheets: the chosen size, or when fitting, the fit
     * size for flat sheets and null for 3D (the stage fits itself).
     */
    sheetMm: (flat: boolean): number | null => {
      if (zoom.kind === "fixed") return zoom.mm;
      return flat ? fitMm : null;
    },
    zoomPct: Math.round((mm / PX_PER_MM_ACTUAL) * 100),
    deskRef,
    /** The 3D stage fills the desk's height, less the Compare captions. */
    stageHeight: Math.max(320, Math.floor(desk.height - captionHeight)),
  };
}

export type Layout = ReturnType<typeof useLayout>;
