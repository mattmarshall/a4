/**
 * 3D rendering: the WebGPU paper on a canvas, and the pointer input on it
 * (a press or drag on the text selects; elsewhere it orbits the camera).
 *
 * It redoes only what changed since the last frame:
 * - content (text, lens, plane, selection, grid, font, texture size) repaints
 *   and uploads the page texture;
 * - the pose re-deforms the paper;
 * - the view, zoom, and desk color update uniforms only.
 *
 * The renderer's lifecycle (creation token, device loss, the reason 3D is
 * unavailable) is `RendererLifecycle`'s.
 */

import { cellAt, pixelRatio, PIXEL_RATIO_CAP, textureDensity } from "../../page/index.ts";
import type { PageModel } from "../paint/model.ts";
import { paintPage } from "../paint/page.ts";
import type { Pose } from "../paper/deform.ts";
import type { GpuProvider } from "../paper/gpu.ts";
import { RendererLifecycle, type RendererState } from "../paper/lifecycle.ts";
import { caretOffset } from "../paper/pick.ts";
import { PaperRenderer } from "../paper/renderer.ts";
import type { A4ViewChange } from "./contract.ts";
import type { EditorSelection } from "./editor.ts";
import { orbit, type SheetState, type SheetView } from "./state.ts";

export interface PaperViewEvents {
  /** The renderer became ready or idle, or 3D became unavailable. */
  status(state: RendererState<PaperRenderer>): void;
  /** A press or drag on the text: put the caret or selection there. */
  select(start: number, end: number, direction: "forward" | "backward" | "none"): void;
  /** The user orbited the camera. */
  orbit(view: A4ViewChange): void;
}

export interface PaperFrame {
  readonly model: PageModel;
  readonly state: SheetState;
  readonly selection: EditorSelection;
  readonly fontFamily: string;
  readonly desk: readonly [number, number, number];
}

/** The parts of a frame that the page texture depends on. */
interface ContentKey {
  readonly model: PageModel;
  readonly start: number;
  readonly end: number;
  readonly focused: boolean;
  readonly grid: boolean;
  readonly fontFamily: string;
  readonly density: number;
}

const sameContent = (a: ContentKey, b: ContentKey) =>
  a.model === b.model &&
  a.start === b.start &&
  a.end === b.end &&
  a.focused === b.focused &&
  a.grid === b.grid &&
  a.fontFamily === b.fontFamily &&
  a.density === b.density;

/** What the renderer is showing now. */
interface Shown {
  content: ContentKey | null;
  pose: Pose | null;
  view: SheetView | null;
  zoom: number | null | undefined;
  desk: readonly [number, number, number] | null;
}

const samePose = (a: Pose | null, b: Pose) =>
  a !== null && a.foldBottom === b.foldBottom && a.foldTop === b.foldTop && a.curl === b.curl;
const sameView = (a: SheetView | null, b: SheetView) =>
  a !== null && a.tilt === b.tilt && a.turn === b.turn && a.light === b.light;
const sameDesk = (a: readonly number[] | null, b: readonly number[]) =>
  a !== null && a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

const NOTHING_SHOWN = (): Shown => ({ content: null, pose: null, view: null, zoom: undefined, desk: null });

/** Light elevation above the desk, in degrees. */
const LIGHT_ELEVATION = 52;

/** Development only: how many times sheets repainted their 3D texture. */
function countTexturePaint() {
  if (!import.meta.env?.DEV) return;
  const g = globalThis as { __a4TexturePaints?: number };
  g.__a4TexturePaints = (g.__a4TexturePaints ?? 0) + 1;
}

export class PaperView {
  readonly canvas: HTMLCanvasElement;
  readonly #texture: HTMLCanvasElement;
  readonly #life: RendererLifecycle<PaperRenderer>;
  readonly #events: PaperViewEvents;
  #shown: Shown = NOTHING_SHOWN();
  /** The last frame drawn, for picking and the start of an orbit. */
  #frame: PaperFrame | null = null;
  #drag: { kind: "select"; anchor: number } | { kind: "orbit"; x: number; y: number; from: A4ViewChange } | null = null;

  constructor(gpu: GpuProvider, events: PaperViewEvents) {
    this.#events = events;
    this.canvas = document.createElement("canvas");
    this.canvas.className = "gpu";
    this.canvas.setAttribute("aria-hidden", "true");
    this.#texture = document.createElement("canvas");
    this.#life = new RendererLifecycle(
      () => PaperRenderer.create(this.canvas, gpu),
      (state) => {
        // A new renderer (or none) shows nothing yet.
        this.#shown = NOTHING_SHOWN();
        events.status(state);
      },
    );
    this.canvas.addEventListener("pointerdown", (e) => this.#pointerDown(e));
    this.canvas.addEventListener("pointermove", (e) => this.#pointerMove(e));
    this.canvas.addEventListener("pointerup", () => this.#pointerUp());
    this.canvas.addEventListener("pointercancel", () => this.#pointerUp());
  }

  get state(): RendererState<PaperRenderer> {
    return this.#life.state;
  }

  /** Create the renderer if there is none yet. */
  start(): void {
    this.#life.ensure();
  }

  /** Repaint the texture on the next draw (fonts loaded, say). */
  invalidate(): void {
    this.#shown.content = null;
  }

  /** Destroy the renderer (the element left the document). */
  stop(): void {
    this.#life.release();
    this.#shown = NOTHING_SHOWN();
    this.#drag = null;
  }

  draw(frame: PaperFrame): void {
    this.#frame = frame;
    const renderer = this.#life.renderer;
    if (!renderer) return;
    const { model, state, selection } = frame;
    const shown = this.#shown;
    let dirty = renderer.resize();
    if (renderer.setPaper({ w: model.spec.paperW, h: model.spec.paperH })) dirty = true;

    const dpr = pixelRatio(window.devicePixelRatio, PIXEL_RATIO_CAP.flat);
    const content: ContentKey = {
      model,
      start: selection.start,
      end: selection.end,
      focused: selection.focused,
      grid: state.grid,
      fontFamily: frame.fontFamily,
      density: textureDensity(this.canvas.clientHeight * Math.min(2, dpr), model.spec.paperH),
    };
    if (!shown.content || !sameContent(shown.content, content)) {
      paintPage(this.#texture, model, {
        fontFamily: frame.fontFamily,
        pxPerMm: content.density,
        selection,
        overflow: false,
        grid: state.grid,
        chrome: "texture",
      });
      renderer.setPage(this.#texture);
      countTexturePaint();
      shown.content = content;
      dirty = true;
    }
    if (!samePose(shown.pose, state.pose)) {
      renderer.setPose(state.pose);
      shown.pose = state.pose;
      dirty = true;
    }
    if (!sameView(shown.view, state.view) || shown.zoom !== state.zoom || !sameDesk(shown.desk, frame.desk)) {
      const { tilt, turn, light } = state.view;
      renderer.setView({ tilt, yaw: turn, lightAzimuth: light, lightElevation: LIGHT_ELEVATION });
      renderer.setZoom(state.zoom);
      renderer.setDeskColor([...frame.desk]);
      shown.view = state.view;
      shown.zoom = state.zoom;
      shown.desk = frame.desk;
      dirty = true;
    }
    if (dirty) renderer.render();
  }

  /** The text offset under a client-space point, or null off the text. */
  #offsetAt(clientX: number, clientY: number): number | null {
    const model = this.#frame?.model;
    const hit = this.#life.renderer?.pick(clientX, clientY);
    if (!model || !hit) return null;
    const cell = cellAt(hit.x, hit.y, model.spec);
    if (!cell) return null;
    return caretOffset(model.rows, model.text.length, cell.row, cell.col);
  }

  #pointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      // The pointer is already gone (canceled touch, synthetic event); drag without capture.
    }
    const offset = this.#offsetAt(e.clientX, e.clientY);
    if (offset !== null) {
      e.preventDefault();
      this.#drag = { kind: "select", anchor: offset };
      this.#events.select(offset, offset, "none");
      return;
    }
    const view = this.#frame?.state.view;
    if (!view) return;
    this.#drag = { kind: "orbit", x: e.clientX, y: e.clientY, from: { tilt: view.tilt, turn: view.turn } };
    this.canvas.style.cursor = "grabbing";
  }

  #pointerMove(e: PointerEvent) {
    const d = this.#drag;
    if (!d) {
      this.canvas.style.cursor = this.#offsetAt(e.clientX, e.clientY) !== null ? "text" : "grab";
      return;
    }
    if (d.kind === "select") {
      const offset = this.#offsetAt(e.clientX, e.clientY);
      if (offset === null) return;
      if (offset < d.anchor) this.#events.select(offset, d.anchor, "backward");
      else this.#events.select(d.anchor, offset, "forward");
      return;
    }
    this.#events.orbit(orbit(d.from, e.clientX - d.x, e.clientY - d.y));
  }

  #pointerUp() {
    if (this.#drag?.kind === "orbit") this.canvas.style.cursor = "grab";
    this.#drag = null;
  }
}
