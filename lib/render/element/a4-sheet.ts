/**
 * <a4-sheet>: one editable A4 page of context, rendered in 3D (WebGPU) or flat,
 * fully contained in a shadow root. Framework-free; the A4 workbench uses it
 * through components/A4Sheet.tsx, but any page can:
 *
 *   <script type="module">import { defineA4Sheet } from ".../a4-sheet.js"; defineA4Sheet();</script>
 *   <a4-sheet value="Purpose: …" lens="syntax" fold-bottom="0.4"></a4-sheet>
 *
 * Attributes and events are declared once in ./contract.ts (`ATTRIBUTES`,
 * `A4SheetEventMap`). Attributes set initial and requested values; `view`
 * and `pose` read what is shown, after any orbit or fold.
 * Properties/methods: value, selectionStart, selectionEnd, view, pose,
 *   render (active rendering), setSelectionRange(), focus(), fold(),
 *   setPlane(), removePlane(), planeNames.
 * Events: input (composed, from the inner textarea), plus the contract's
 *   a4-focus, a4-render, a4-viewchange, and a4-posechange.
 *
 * The element composes four controllers, each told only what it needs:
 * - EditorSurface: the textarea (text, selection, focus, IME, undo);
 * - FlatView: the painted page for flat rendering;
 * - PaperView: the WebGPU paper, its lifecycle, and orbit and pick input;
 * - PrintLayer: the text the print stylesheet shows.
 * Its display state is a pure reducer over attributes, orbit, and poses
 * (state.ts).
 */

import { fitScale, layoutRows, PIXEL_RATIO_CAP, pixelRatio, type PageSpec } from "../../page/index.ts";
import { pageModel, withPlane, type PageModel, type PagePlane } from "../paint/model.ts";
import { FOLD_DURATION, foldPoseAt } from "../paper/animation.ts";
import { FLAT, type Pose } from "../paper/deform.ts";
import { browserGpu, type GpuProvider } from "../paper/gpu.ts";
import {
  A4_EVENTS,
  A4_SHEET_TAG,
  a4Event,
  ATTRIBUTES,
  OBSERVED_ATTRIBUTES,
  type A4AttributeName,
  type A4Render,
  type A4SheetEventMap,
  type A4ViewChange,
} from "./contract.ts";
import { EditorSurface } from "./editor.ts";
import { FlatView } from "./flat-view.ts";
import { PaperView } from "./paper-view.ts";
import { PrintLayer } from "./print-layer.ts";
import { changes, INITIAL_STATE, isPoseAttribute, reduce, type SheetAction, type SheetState } from "./state.ts";
import { DEFAULT_FONT, SHEET_STYLE } from "./style.ts";

export type { A4Render, A4RenderRequest, A4SheetEventMap } from "./contract.ts";

declare global {
  interface HTMLElementTagNameMap {
    "a4-sheet": A4SheetElement;
  }
}

/**
 * Per-cell values for a model lens: one value in [0, 1] per cell of `text`'s
 * grid on the sheet's preset (row-major, `cols` wide, max(page rows, rows
 * used) tall).
 */
export interface A4Plane {
  text: string;
  values: Float32Array;
  label?: string;
}

interface StoredPlane {
  readonly text: string;
  readonly values: Float32Array;
  readonly label: string;
  readonly cols: number;
}

/** Cells in `text`'s grid on `spec`: the page's rows, or more when the text overflows. */
function cellCount(text: string, spec: PageSpec): number {
  return Math.max(spec.rows, layoutRows(text, spec.cols).length) * spec.cols;
}

const DESK_FALLBACK: readonly [number, number, number] = [0.91, 0.9, 0.87];

function cssColor(value: string): readonly [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(value.trim());
  if (!m?.[1]) return DESK_FALLBACK;
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

type Listener<E> = (this: A4SheetElement, event: E) => unknown;

export class A4SheetElement extends HTMLElement {
  static observedAttributes = OBSERVED_ATTRIBUTES;
  /**
   * Where 3D rendering gets its GPU device: the browser's WebGPU, shared by
   * every sheet. Set it before a sheet is created to supply another.
   */
  static gpu: GpuProvider = browserGpu();

  readonly #root: ShadowRoot;
  readonly #stage: HTMLDivElement;
  readonly #editor: EditorSurface;
  readonly #flat: FlatView;
  readonly #paper: PaperView;
  readonly #print: PrintLayer;

  #state: SheetState = INITIAL_STATE;
  readonly #planes = new Map<string, StoredPlane>();
  #model: PageModel | null = null;
  #reported: A4Render | null = null;
  #frame = 0;
  #animation = 0;
  #fontFamily = DEFAULT_FONT;
  #fontsRequested = false;
  #resize: ResizeObserver | null = null;
  #desk: { readonly css: string; readonly rgb: readonly [number, number, number] } | null = null;
  #explainedFlat = false;

  constructor() {
    super();
    this.#root = this.attachShadow({ mode: "open", delegatesFocus: true });
    const style = document.createElement("style");
    style.textContent = SHEET_STYLE;
    this.#stage = document.createElement("div");
    this.#stage.className = "stage";

    this.#editor = new EditorSurface(this.#root, {
      input: () => this.#schedule(),
      selection: () => this.#schedule(),
      focus: () => this.dispatchEvent(a4Event(A4_EVENTS.focus, null)),
    });
    this.#flat = new FlatView(this.#editor.element);
    const { gpu } = this.constructor as typeof A4SheetElement;
    this.#paper = new PaperView(gpu, {
      status: () => this.#applyRender(),
      select: (start, end, direction) => {
        this.#editor.focus();
        this.#editor.select(start, end, direction);
      },
      orbit: (view) => {
        this.#dispatch({ type: "orbit", view });
        this.dispatchEvent(a4Event(A4_EVENTS.viewChange, view));
      },
    });
    this.#print = new PrintLayer();

    for (const node of [this.#paper.canvas, this.#flat.element, this.#print.element]) this.#stage.appendChild(node);
    this.#root.appendChild(style);
    this.#root.appendChild(this.#stage);
  }

  // -------------------------------------------------------------------------
  // Lifecycle

  connectedCallback() {
    // A property set before upgrade shadows the accessor; re-apply it.
    if (Object.hasOwn(this, "value")) {
      const v: unknown = Reflect.get(this, "value");
      Reflect.deleteProperty(this, "value");
      this.value = String(v ?? "");
    }
    this.#editor.seed(this.getAttribute("value") ?? "");
    this.#resize = new ResizeObserver(() => this.#schedule());
    this.#resize.observe(this);
    this.#editor.connect();
    this.#print.connect();
    this.#loadFonts();
    this.#applyRender();
  }

  disconnectedCallback() {
    this.#resize?.disconnect();
    this.#resize = null;
    this.#editor.disconnect();
    this.#print.disconnect();
    if (this.#frame) cancelAnimationFrame(this.#frame);
    this.#frame = 0;
    this.#stopAnimation();
    this.#paper.stop();
  }

  /** Every set applies, even when it equals the previous attribute value (after an orbit, say). */
  attributeChangedCallback(name: A4AttributeName, _old: string | null, value: string | null) {
    if (name === "value") {
      this.#editor.seed(ATTRIBUTES.value.parse(value));
      this.#schedule();
      return;
    }
    if (isPoseAttribute(name)) this.#stopAnimation();
    this.#dispatch({ type: "attribute", name, value });
  }

  #dispatch(action: SheetAction) {
    const prev = this.#state;
    this.#state = reduce(prev, action);
    const changed = changes(prev, this.#state);
    if (changed.label) this.#editor.setLabel(this.#state.label);
    if (changed.render) this.#applyRender();
    this.#schedule();
  }

  // -------------------------------------------------------------------------
  // Typed events (A4SheetEventMap), alongside the standard ones.

  override addEventListener<K extends keyof A4SheetEventMap>(
    type: K,
    listener: Listener<A4SheetEventMap[K]>,
    options?: boolean | AddEventListenerOptions,
  ): void;
  override addEventListener<K extends keyof HTMLElementEventMap>(
    type: K,
    listener: Listener<HTMLElementEventMap[K]>,
    options?: boolean | AddEventListenerOptions,
  ): void;
  override addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
  override addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void {
    super.addEventListener(type, listener, options);
  }

  override removeEventListener<K extends keyof A4SheetEventMap>(
    type: K,
    listener: Listener<A4SheetEventMap[K]>,
    options?: boolean | EventListenerOptions,
  ): void;
  override removeEventListener<K extends keyof HTMLElementEventMap>(
    type: K,
    listener: Listener<HTMLElementEventMap[K]>,
    options?: boolean | EventListenerOptions,
  ): void;
  override removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void;
  override removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void {
    super.removeEventListener(type, listener, options);
  }

  // -------------------------------------------------------------------------
  // Public API

  get value(): string {
    return this.#editor.value;
  }

  set value(text: string) {
    this.#editor.value = String(text ?? "");
    this.#schedule();
  }

  get selectionStart(): number {
    return this.#editor.element.selectionStart;
  }

  get selectionEnd(): number {
    return this.#editor.element.selectionEnd;
  }

  /** The rendering in use: "3d", "flat", or null while undecided. */
  get render(): A4Render | null {
    return this.#reported;
  }

  /** The camera shown now, including after the user orbits it. */
  get view(): A4ViewChange {
    return { tilt: this.#state.view.tilt, turn: this.#state.view.turn };
  }

  /** The paper's pose shown now, including during and after `fold()`. */
  get pose(): Pose {
    return { ...this.#state.pose };
  }

  /**
   * Set a named plane of per-cell values for a model lens. Throws RangeError
   * when the value count doesn't match the plane text's grid.
   */
  setPlane(name: string, plane: A4Plane) {
    if (!name) throw new RangeError("A plane needs a name.");
    const { spec } = this.#state;
    const expected = cellCount(plane.text, spec);
    if (!(plane.values instanceof Float32Array) || plane.values.length !== expected) {
      throw new RangeError(
        `Plane "${name}" has ${plane.values?.length ?? 0} values; its text's grid has ${expected} cells.`,
      );
    }
    this.#planes.set(name, { text: plane.text, values: plane.values, label: plane.label ?? name, cols: spec.cols });
    this.#schedule();
  }

  removePlane(name: string) {
    if (this.#planes.delete(name)) this.#schedule();
  }

  /** Names of the planes set on this sheet. */
  get planeNames(): string[] {
    return [...this.#planes.keys()];
  }

  setSelectionRange(start: number, end: number, direction?: "forward" | "backward" | "none") {
    this.#editor.select(start, end, direction);
  }

  override focus(options?: FocusOptions) {
    this.#editor.focus(options);
  }

  /** Play the letter-fold animation (or toggle the pose with reduced motion). */
  fold() {
    this.#stopAnimation();
    if (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const { pose } = this.#state;
      const folded = pose.foldBottom === 1 && pose.foldTop === 1;
      this.#dispatch({ type: "pose", pose: folded ? FLAT : { foldBottom: 1, foldTop: 1, curl: 0 } });
      this.#emitPose();
      return;
    }
    const started = performance.now();
    const step = (now: number) => {
      const t = (now - started) / 1000;
      // A fold frame changes only the pose: the renderer re-deforms the paper, and nothing repaints.
      this.#state = reduce(this.#state, { type: "pose", pose: foldPoseAt(t) });
      this.#paint();
      if (t >= FOLD_DURATION) {
        this.#animation = 0;
        this.#emitPose();
        return;
      }
      this.#animation = requestAnimationFrame(step);
    };
    this.#animation = requestAnimationFrame(step);
  }

  // -------------------------------------------------------------------------
  // Internals

  #stopAnimation() {
    if (this.#animation) cancelAnimationFrame(this.#animation);
    this.#animation = 0;
  }

  #emitPose() {
    this.dispatchEvent(a4Event(A4_EVENTS.poseChange, this.pose));
  }

  #effectiveRender(): A4Render {
    if (this.#state.request === "flat" || this.#paper.state.kind === "unavailable") return "flat";
    return "3d";
  }

  #applyRender() {
    if (!this.isConnected) return;
    const render = this.#effectiveRender();
    this.#stage.dataset.render = render;
    if (render === "3d") this.#paper.start();
    const status = this.#paper.state;
    if (status.kind === "unavailable" && this.#state.request !== "flat" && !this.#explainedFlat) {
      this.#explainedFlat = true;
      console.info(`<a4-sheet> renders flat: ${status.reason}`);
    }
    // Report only settled renderings: 3D once the renderer exists, or flat.
    const settled: A4Render | null = render === "flat" || status.kind === "ready" ? render : null;
    if (settled && settled !== this.#reported) {
      this.#reported = settled;
      this.dispatchEvent(a4Event(A4_EVENTS.render, settled));
    }
    this.#schedule();
  }

  #loadFonts() {
    const family = getComputedStyle(this).getPropertyValue("--a4-font").trim();
    if (family) this.#fontFamily = family;
    if (this.#fontsRequested || typeof document.fonts === "undefined") return;
    this.#fontsRequested = true;
    Promise.all([
      document.fonts.load(`400 16px ${this.#fontFamily}`),
      document.fonts.load(`600 16px ${this.#fontFamily}`),
    ])
      .catch(() => {})
      .finally(() => {
        // Glyphs painted before the font arrived used a fallback: paint them again.
        this.#flat.invalidate();
        this.#paper.invalidate();
        this.#schedule();
      });
  }

  /** The active model lens's values, if they still describe this exact text on this preset. */
  #plane(text: string): PagePlane | undefined {
    const { plane: name, spec } = this.#state;
    const plane = name ? this.#planes.get(name) : undefined;
    if (!plane || plane.text !== text || plane.cols !== spec.cols) return undefined;
    if (plane.values.length !== cellCount(text, spec)) return undefined;
    return { values: plane.values, cols: plane.cols };
  }

  /** The page as the painter sees it, rebuilt only when the text, preset, lens, or plane changed. */
  #getModel(): PageModel {
    const text = this.#editor.value;
    const { spec, lens } = this.#state;
    const m = this.#model;
    const base = m && m.text === text && m.spec === spec && m.lens === lens ? m : pageModel(text, spec, lens);
    const plane = this.#plane(text);
    this.#model = base.plane?.values === plane?.values ? base : withPlane(base, plane);
    return this.#model;
  }

  /** The desk color behind the 3D paper (`--a4-desk`), parsed once per value. */
  #deskColor(): readonly [number, number, number] {
    const css = getComputedStyle(this).getPropertyValue("--a4-desk");
    if (this.#desk?.css !== css) this.#desk = { css, rgb: cssColor(css) };
    return this.#desk.rgb;
  }

  #schedule() {
    if (this.#frame || !this.isConnected) return;
    this.#frame = requestAnimationFrame(() => {
      this.#frame = 0;
      this.#paint();
    });
  }

  /** Flat sheet scale in CSS px per mm. */
  #flatScale(): number {
    return this.#state.zoom ?? fitScale({ width: this.clientWidth });
  }

  #paint() {
    if (!this.isConnected) return;
    const model = this.#getModel();
    const state = this.#state;
    const scale = this.#flatScale();
    this.#editor.layout(state.spec, scale, model.rows.length);
    this.#print.update(model);
    if (this.#effectiveRender() === "flat") {
      const dpr = pixelRatio(window.devicePixelRatio, PIXEL_RATIO_CAP.flat);
      this.#flat.draw(model, { scale, pxPerMm: scale * dpr, fontFamily: this.#fontFamily, grid: state.grid });
      return;
    }
    this.#paper.draw({
      model,
      state,
      selection: this.#editor.selection,
      fontFamily: this.#fontFamily,
      desk: this.#deskColor(),
    });
  }
}

/** Whether `A4SheetElement` itself is registered (under any name). */
function baseRegistered(): boolean {
  const registry = customElements as CustomElementRegistry & {
    getName?(ctor: CustomElementConstructor): string | null;
  };
  return baseDefined || (registry.getName?.(A4SheetElement) ?? null) !== null;
}
let baseDefined = false;

/**
 * Register the sheet as <a4-sheet>, or under another name. Safe to call more
 * than once, and with several names: a constructor can be registered only
 * once, so each name after the first gets its own subclass.
 */
export function defineA4Sheet(name: string = A4_SHEET_TAG): void {
  if (typeof customElements === "undefined" || customElements.get(name)) return;
  if (!baseRegistered()) {
    customElements.define(name, A4SheetElement);
    baseDefined = true;
    return;
  }
  customElements.define(name, class extends A4SheetElement {});
}
