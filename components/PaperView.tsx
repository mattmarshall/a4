"use client";

/**
 * PaperView: the open page as a WebGPU sheet that folds, curls, tilts, and is
 * lit — while it stays editable. The real textarea (rendered off-stage by the
 * Workbench) keeps focus; clicks on the sheet are ray-cast to grid cells and
 * become textarea selections, and the page texture repaints from the model.
 */

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { Analysis } from "@/lib/analyze";
import type { LensId } from "@/lib/lenses";
import type { PageSpec } from "@/lib/page-spec";
import { FOLD_DURATION, foldPoseAt } from "@/lib/paper/animation";
import { FLAT, withPose, type Pose } from "@/lib/paper/deform";
import { caretOffset, cellAt } from "@/lib/paper/pick";
import { PaperRenderer, WebGpuUnavailableError, type View } from "@/lib/paper/renderer";
import { paintPage } from "@/lib/paper/texture";

const DEFAULT_VIEW: View = { tilt: 32, yaw: 0, lightAzimuth: 215, lightElevation: 52 };

function cssColor(name: string, fallback: [number, number, number]): [number, number, number] {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const m = /^#([0-9a-f]{6})$/i.exec(value);
  if (!m) return fallback;
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
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
    <label className="paper-slider">
      <span>
        {label} <em>{format ? format(value) : value.toFixed(2)}</em>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

export function PaperView({
  text,
  spec,
  lens,
  analysis,
  textareaId,
}: {
  text: string;
  spec: PageSpec;
  lens: LensId;
  analysis: Analysis;
  /** id of the (off-stage) textarea that owns editing. */
  textareaId: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<PaperRenderer | null>(null);
  const pageCanvas = useRef<HTMLCanvasElement | null>(null);
  // The renderer instance itself is state, so a recreated renderer (remount,
  // hot reload) always gets its texture, pose, and camera again.
  const [renderer, setRenderer] = useState<PaperRenderer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pose, setPose] = useState<Pose>(FLAT);
  const [view, setView] = useState<View>(DEFAULT_VIEW);
  const [playing, setPlaying] = useState(false);
  const [selection, setSelection] = useState({ start: 0, end: 0, focused: false });
  const [fontFamily, setFontFamily] = useState<string | null>(null);
  const [cursor, setCursor] = useState("grab");
  const drag = useRef<{ kind: "select"; anchor: number } | { kind: "orbit"; x: number; y: number; tilt: number; yaw: number } | null>(null);
  const animation = useRef<number | null>(null);

  const textarea = useCallback(() => document.getElementById(textareaId) as HTMLTextAreaElement | null, [textareaId]);

  // Create the renderer.
  useEffect(() => {
    let disposed = false;
    const canvas = canvasRef.current;
    if (!canvas) return;
    PaperRenderer.create(canvas)
      .then((renderer) => {
        if (disposed) {
          renderer.destroy();
          return;
        }
        rendererRef.current = renderer;
        renderer.setDeskColor(cssColor("--desk", [0.91, 0.9, 0.87]));
        renderer.resize();
        setRenderer(renderer);
      })
      .catch((e: unknown) => {
        if (!disposed) {
          setError(
            e instanceof WebGpuUnavailableError
              ? e.message
              : `Couldn’t start WebGPU: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      });
    return () => {
      disposed = true;
      rendererRef.current?.destroy();
      rendererRef.current = null;
      setRenderer(null);
    };
  }, []);

  // Load the page font before painting so the canvas uses IBM Plex Mono.
  useEffect(() => {
    const family = getComputedStyle(document.documentElement).getPropertyValue("--font-plex-mono").trim() || "monospace";
    Promise.all([document.fonts.load(`400 16px ${family}`), document.fonts.load(`600 16px ${family}`)])
      .catch(() => {})
      .finally(() => setFontFamily(family));
  }, []);

  // Track the textarea's selection and focus (it owns the caret).
  useEffect(() => {
    const read = () => {
      const el = textarea();
      if (!el) return;
      setSelection((s) => {
        const next = { start: el.selectionStart, end: el.selectionEnd, focused: document.activeElement === el };
        return s.start === next.start && s.end === next.end && s.focused === next.focused ? s : next;
      });
    };
    const events = ["selectionchange", "keyup", "input", "focusin", "focusout", "select"] as const;
    for (const e of events) document.addEventListener(e, read);
    read();
    return () => {
      for (const e of events) document.removeEventListener(e, read);
    };
  }, [textarea, text]);

  const draw = useCallback(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.resize();
    renderer.render();
  }, []);

  // Repaint the page texture from the model.
  useEffect(() => {
    if (!renderer || !fontFamily) return;
    pageCanvas.current ??= document.createElement("canvas");
    const heightPx = renderer.canvas.clientHeight * Math.min(2, window.devicePixelRatio || 1);
    const pxPerMm = Math.min(10, Math.max(5, Math.ceil((heightPx / 297) * 1.3)));
    paintPage(pageCanvas.current, { text, spec, analysis, lens, fontFamily, pxPerMm, selection });
    renderer.setPage(pageCanvas.current);
    draw();
  }, [renderer, fontFamily, text, spec, analysis, lens, selection, draw]);

  useEffect(() => {
    if (!renderer) return;
    renderer.setPose(pose);
    renderer.setView(view);
    draw();
  }, [renderer, pose, view, draw]);

  // Keep the backing store sized to the element.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [draw]);

  const stop = useCallback(() => {
    if (animation.current !== null) cancelAnimationFrame(animation.current);
    animation.current = null;
    setPlaying(false);
  }, []);

  useEffect(() => stop, [stop]);

  function playFold() {
    stop();
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      // No animation: toggle between flat and folded.
      setPose((p) => (p.foldBottom === 1 && p.foldTop === 1 ? FLAT : { foldBottom: 1, foldTop: 1, curl: 0 }));
      return;
    }
    setPlaying(true);
    const started = performance.now();
    const frame = (now: number) => {
      const t = (now - started) / 1000;
      setPose(foldPoseAt(t));
      if (t >= FOLD_DURATION) {
        stop();
        return;
      }
      animation.current = requestAnimationFrame(frame);
    };
    animation.current = requestAnimationFrame(frame);
  }

  function offsetAt(clientX: number, clientY: number): number | null {
    const hit = rendererRef.current?.pick(clientX, clientY);
    if (!hit) return null;
    const cell = cellAt(hit.x, hit.y, spec);
    if (!cell) return null;
    return caretOffset(analysis.rows, text.length, cell.row, cell.col);
  }

  function onPointerDown(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (e.button !== 0) return;
    const offset = offsetAt(e.clientX, e.clientY);
    e.currentTarget.setPointerCapture(e.pointerId);
    if (offset !== null) {
      e.preventDefault();
      const el = textarea();
      if (!el) return;
      el.focus({ preventScroll: true });
      el.setSelectionRange(offset, offset);
      drag.current = { kind: "select", anchor: offset };
      setSelection({ start: offset, end: offset, focused: true });
    } else {
      drag.current = { kind: "orbit", x: e.clientX, y: e.clientY, tilt: view.tilt, yaw: view.yaw };
      setCursor("grabbing");
    }
  }

  function onPointerMove(e: ReactPointerEvent<HTMLCanvasElement>) {
    const d = drag.current;
    if (!d) {
      setCursor(offsetAt(e.clientX, e.clientY) !== null ? "text" : "grab");
      return;
    }
    if (d.kind === "select") {
      const offset = offsetAt(e.clientX, e.clientY);
      const el = textarea();
      if (offset === null || !el) return;
      const [a, b] = offset < d.anchor ? [offset, d.anchor] : [d.anchor, offset];
      el.setSelectionRange(a, b, offset < d.anchor ? "backward" : "forward");
      setSelection({ start: a, end: b, focused: true });
    } else {
      setView((v) => ({
        ...v,
        yaw: ((((d.yaw + (e.clientX - d.x) * 0.3 + 180) % 360) + 360) % 360) - 180,
        tilt: Math.max(0, Math.min(65, d.tilt + (e.clientY - d.y) * 0.25)),
      }));
    }
  }

  function onPointerUp() {
    if (drag.current?.kind === "orbit") setCursor("grab");
    drag.current = null;
  }

  if (error) {
    return (
      <div className="paper-unavailable" role="status">
        <strong>3D needs WebGPU.</strong>
        <span>{error}</span>
        <span>The Single and Compare views still work.</span>
      </div>
    );
  }

  return (
    <div className="paper-view">
      <canvas
        ref={canvasRef}
        className="paper-canvas"
        style={{ cursor }}
        aria-label="3D view of the page. Click the paper to place the caret; drag the desk to turn the camera."
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
      <div className="paper-controls" aria-label="3D controls">
        <div className="paper-actions">
          <button type="button" className="btn btn-outline" onClick={playFold} disabled={playing}>
            {playing ? "Folding…" : "▶ Fold"}
          </button>
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => {
              stop();
              setPose(FLAT);
              setView(DEFAULT_VIEW);
            }}
          >
            Reset
          </button>
        </div>
        <Slider label="Bottom fold" value={pose.foldBottom} min={0} max={1} step={0.01} onChange={(v) => { stop(); setPose((p) => withPose(p, { foldBottom: v })); }} />
        <Slider label="Top fold" value={pose.foldTop} min={0} max={1} step={0.01} onChange={(v) => { stop(); setPose((p) => withPose(p, { foldTop: v })); }} />
        <Slider label="Corner curl" value={pose.curl} min={0} max={1} step={0.01} onChange={(v) => { stop(); setPose((p) => withPose(p, { curl: v })); }} />
        <Slider label="Tilt" value={view.tilt} min={0} max={65} step={1} format={(v) => `${v}°`} onChange={(v) => setView((s) => ({ ...s, tilt: v }))} />
        <Slider label="Turn" value={view.yaw} min={-180} max={180} step={1} format={(v) => `${v}°`} onChange={(v) => setView((s) => ({ ...s, yaw: v }))} />
        <Slider label="Light" value={view.lightAzimuth} min={0} max={360} step={1} format={(v) => `${v}°`} onChange={(v) => setView((s) => ({ ...s, lightAzimuth: v }))} />
        <p className="paper-hint">Click the paper to type there. Drag the desk to turn.</p>
      </div>
    </div>
  );
}
