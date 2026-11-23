/**
 * <a4-sheet>: one editable A4 page of context, rendered in 3D (WebGPU) or flat,
 * fully contained in a shadow root. Framework-free; the A4 workbench uses it
 * through components/A4Sheet.tsx, but any page can:
 *
 *   <script type="module">import { defineA4Sheet } from ".../a4-sheet"; defineA4Sheet();</script>
 *   <a4-sheet value="Purpose: …" lens="syntax" fold-bottom="0.4"></a4-sheet>
 *
 * Attributes: value (initial), preset, lens, render (3d | flat | auto),
 *   fold-bottom, fold-top, curl (0–1), tilt (0–65), turn (−180–180), light
 *   (azimuth°), zoom (px per mm | fit), grid (boolean), label.
 * Properties/methods: value, selectionStart, selectionEnd,
 *   setSelectionRange(), focus(), fold(), render (active rendering).
 * Events: input (composed, from the inner textarea), a4-focus, a4-render
 *   (detail: "3d" | "flat"), a4-viewchange (detail: { tilt, turn }),
 *   a4-posechange (detail: Pose).
 */

import { analyze, type Analysis } from "../analyze.ts";
import { isLensId, type LensId } from "../lenses.ts";
import { DEFAULT_PRESET, fontSizeMm, isPresetId, PRESETS, PX_PER_MM_ACTUAL, type PageSpec } from "../page-spec.ts";
import { FOLD_DURATION, foldPoseAt } from "../paper/animation.ts";
import { FLAT, PAPER_H, PAPER_W, type Pose } from "../paper/deform.ts";
import { caretOffset, cellAt } from "../paper/pick.ts";
import { PaperRenderer } from "../paper/renderer.ts";
import { paintPage, printRows } from "../paper/texture.ts";
import { layoutRows, normalizeText, TAB_SPACES } from "../text.ts";

export type A4Render = "3d" | "flat";
export type A4RenderRequest = A4Render | "auto";

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

const MODEL_LENS = "model:";

const DEFAULT_FONT = '"IBM Plex Mono", ui-monospace, "SF Mono", Menlo, monospace';

const STYLE = /* css */ `
:host {
  display: block;
  position: relative;
  --_font: var(--a4-font, ${DEFAULT_FONT});
}
:host([hidden]) { display: none; }
.stage { position: relative; overflow: hidden; }
.stage[data-render="3d"] { height: var(--a4-3d-height, 70vh); min-height: 260px; }
.gpu {
  display: none;
  width: 100%;
  height: 100%;
  border-radius: var(--a4-radius, 12px);
  touch-action: none;
}
.stage[data-render="3d"] .gpu { display: block; }
.flat { position: relative; margin: 0 auto; }
.stage[data-render="3d"] .flat {
  position: absolute;
  left: 0;
  top: 0;
  opacity: 0;
  pointer-events: none;
}
.stage[data-render="3d"] .page,
.stage[data-render="3d"] .paper { display: none; }
.paper {
  position: absolute;
  left: 0;
  top: 0;
  background: #fdfcf8;
  box-shadow: var(--a4-shadow, 0 1px 2px #0000000f, 0 8px 28px #0000001c);
}
.page { position: absolute; left: 0; top: 0; display: block; }
.input {
  position: absolute;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 0;
  resize: none;
  overflow: hidden;
  outline: none;
  appearance: none;
  background: transparent;
  color: transparent;
  caret-color: #1d1c1a;
  font-family: var(--_font);
  font-weight: 400;
  letter-spacing: 0;
  word-spacing: 0;
  font-kerning: none;
  font-variant-ligatures: none;
  font-feature-settings: "liga" 0, "calt" 0;
  white-space: break-spaces;
  word-break: break-all;
  overflow-wrap: anywhere;
  line-break: anywhere;
  tab-size: 2;
  text-align: left;
}
.input::selection { background: #3b82f640; color: transparent; }
.input::placeholder { color: #a29d92; }
.print { display: none; }
@media print {
  :host {
    display: block !important;
    width: 210mm !important;
    height: 297mm !important;
    overflow: hidden;
    break-before: page;
    break-after: page;
    break-inside: avoid;
  }
  .stage { height: 297mm !important; }
  .gpu, .flat { display: none !important; }
  .print {
    display: block;
    position: absolute;
    inset: 0;
    background: #fff;
    color: #000;
    font-family: var(--_font);
  }
  .print div { position: absolute; white-space: pre; }
}
`;

function numberAttr(value: string | null, fallback: number, lo: number, hi: number): number {
  const n = value === null ? Number.NaN : Number(value);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
}

function cssColor(value: string, fallback: [number, number, number]): [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(value.trim());
  if (!m) return fallback;
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** Insert text at the caret, keeping the browser's native undo stack. */
function insertAtCaret(el: HTMLTextAreaElement, insert: string) {
  el.focus({ preventScroll: true });
  // execCommand is deprecated but is still the only way to keep native undo.
  const ok = typeof document.execCommand === "function" && document.execCommand("insertText", false, insert);
  if (!ok) {
    el.setRangeText(insert, el.selectionStart, el.selectionEnd, "end");
    el.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  }
}

const OBSERVED = [
  "value",
  "preset",
  "lens",
  "render",
  "fold-bottom",
  "fold-top",
  "curl",
  "tilt",
  "turn",
  "light",
  "zoom",
  "grid",
  "label",
] as const;

export class A4SheetElement extends HTMLElement {
  static observedAttributes = OBSERVED;

  readonly #root: ShadowRoot;
  readonly #stage: HTMLDivElement;
  readonly #gpuCanvas: HTMLCanvasElement;
  readonly #flat: HTMLDivElement;
  readonly #paper: HTMLDivElement;
  readonly #pageCanvas: HTMLCanvasElement;
  readonly #input: HTMLTextAreaElement;
  readonly #print: HTMLDivElement;
  readonly #texture: HTMLCanvasElement;

  #spec: PageSpec = PRESETS[DEFAULT_PRESET];
  #lens: LensId = "ink";
  /** The plane shown by `lens="model:<name>"`, or null for a built-in lens. */
  #modelLens: string | null = null;
  readonly #planes = new Map<string, { text: string; values: Float32Array; label: string; cols: number }>();
  #request: A4RenderRequest = "auto";
  #reported: A4Render | null = null;
  #gpu: "unknown" | "ok" | "unavailable" = "unknown";
  #renderer: PaperRenderer | null = null;
  #creating = false;
  #pose: Pose = FLAT;
  #view = { tilt: 32, yaw: 0, lightAzimuth: 215, lightElevation: 52 };
  #zoom: number | null = null;
  #grid = false;
  #valueInitialized = false;
  #analysis: { text: string; spec: PageSpec; result: Analysis } | null = null;
  #printed: Analysis | null = null;
  #frame = 0;
  #animation = 0;
  #fontFamily = DEFAULT_FONT;
  #fontsRequested = false;
  #resize: ResizeObserver | null = null;
  #drag: { kind: "select"; anchor: number } | { kind: "orbit"; x: number; y: number; tilt: number; yaw: number } | null =
    null;
  #onBeforePrint = () => this.#fillPrint();
  #onDocSelection = () => {
    if (this.#root.activeElement === this.#input) this.#schedule();
  };

  constructor() {
    super();
    this.#root = this.attachShadow({ mode: "open", delegatesFocus: true });
    const style = document.createElement("style");
    style.textContent = STYLE;
    this.#stage = document.createElement("div");
    this.#stage.className = "stage";
    this.#gpuCanvas = document.createElement("canvas");
    this.#gpuCanvas.className = "gpu";
    this.#gpuCanvas.setAttribute("aria-hidden", "true");
    this.#flat = document.createElement("div");
    this.#flat.className = "flat";
    this.#paper = document.createElement("div");
    this.#paper.className = "paper";
    this.#pageCanvas = document.createElement("canvas");
    this.#pageCanvas.className = "page";
    this.#pageCanvas.setAttribute("aria-hidden", "true");
    this.#input = document.createElement("textarea");
    this.#input.className = "input";
    this.#input.spellcheck = false;
    this.#input.setAttribute("autocorrect", "off");
    this.#input.setAttribute("autocapitalize", "off");
    this.#input.setAttribute("autocomplete", "off");
    this.#input.setAttribute("wrap", "soft");
    this.#input.placeholder = "Write the context you would hand an agent…";
    this.#print = document.createElement("div");
    this.#print.className = "print";
    this.#print.setAttribute("aria-hidden", "true");
    for (const node of [this.#paper, this.#pageCanvas, this.#input]) this.#flat.appendChild(node);
    for (const node of [this.#gpuCanvas, this.#flat, this.#print]) this.#stage.appendChild(node);
    this.#root.appendChild(style);
    this.#root.appendChild(this.#stage);
    this.#texture = document.createElement("canvas");

    this.#input.addEventListener("input", () => {
      const v = this.#input.value;
      if (/[\t\r]/.test(v)) this.#setInputValue(normalizeText(v));
      this.#schedule();
    });
    this.#input.addEventListener("keydown", (e) => {
      if (e.key === "Tab" && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        insertAtCaret(this.#input, TAB_SPACES);
      }
    });
    this.#input.addEventListener("paste", (e) => {
      const raw = e.clipboardData?.getData("text/plain");
      if (!raw) return;
      const clean = normalizeText(raw);
      if (clean === raw) return;
      e.preventDefault();
      insertAtCaret(this.#input, clean);
    });
    this.#input.addEventListener("focus", () => {
      this.dispatchEvent(new CustomEvent("a4-focus", { bubbles: true, composed: true }));
      this.#schedule();
    });
    for (const type of ["blur", "select", "keyup", "selectionchange", "pointerup"]) {
      this.#input.addEventListener(type, () => this.#schedule());
    }

    this.#gpuCanvas.addEventListener("pointerdown", (e) => this.#pointerDown(e));
    this.#gpuCanvas.addEventListener("pointermove", (e) => this.#pointerMove(e));
    this.#gpuCanvas.addEventListener("pointerup", () => this.#pointerUp());
    this.#gpuCanvas.addEventListener("pointercancel", () => this.#pointerUp());
  }

  // -------------------------------------------------------------------------
  // Lifecycle

  connectedCallback() {
    // A property set before upgrade shadows the accessor; re-apply it.
    if (Object.prototype.hasOwnProperty.call(this, "value")) {
      const v = (this as unknown as { value: string }).value;
      delete (this as unknown as { value?: string }).value;
      this.value = v;
    }
    if (!this.#valueInitialized) this.#setInputValue(this.getAttribute("value") ?? "");
    this.#resize = new ResizeObserver(() => this.#schedule());
    this.#resize.observe(this);
    window.addEventListener("beforeprint", this.#onBeforePrint);
    document.addEventListener("selectionchange", this.#onDocSelection);
    this.#loadFonts();
    this.#applyRender();
  }

  disconnectedCallback() {
    this.#resize?.disconnect();
    this.#resize = null;
    window.removeEventListener("beforeprint", this.#onBeforePrint);
    document.removeEventListener("selectionchange", this.#onDocSelection);
    if (this.#frame) cancelAnimationFrame(this.#frame);
    this.#frame = 0;
    this.#stopAnimation();
    this.#renderer?.destroy();
    this.#renderer = null;
    this.#creating = false;
  }

  attributeChangedCallback(name: (typeof OBSERVED)[number], _old: string | null, value: string | null) {
    switch (name) {
      case "value":
        if (!this.#valueInitialized) this.#setInputValue(value ?? "");
        break;
      case "preset":
        this.#spec = PRESETS[isPresetId(value) ? value : DEFAULT_PRESET];
        break;
      case "lens":
        if (value?.startsWith(MODEL_LENS) && value.length > MODEL_LENS.length) {
          this.#modelLens = value.slice(MODEL_LENS.length);
          this.#lens = "ink";
        } else {
          this.#modelLens = null;
          this.#lens = isLensId(value) ? value : "ink";
        }
        break;
      case "render":
        this.#request = value === "3d" || value === "flat" ? value : "auto";
        this.#applyRender();
        break;
      case "fold-bottom":
      case "fold-top":
      case "curl": {
        this.#stopAnimation();
        const key = name === "fold-bottom" ? "foldBottom" : name === "fold-top" ? "foldTop" : "curl";
        this.#pose = { ...this.#pose, [key]: numberAttr(value, 0, 0, 1) };
        break;
      }
      case "tilt":
        this.#view = { ...this.#view, tilt: numberAttr(value, 32, 0, 65) };
        break;
      case "turn":
        this.#view = { ...this.#view, yaw: numberAttr(value, 0, -180, 180) };
        break;
      case "light":
        this.#view = { ...this.#view, lightAzimuth: numberAttr(value, 215, -360, 720) };
        break;
      case "zoom":
        this.#zoom = value === null || value === "fit" ? null : numberAttr(value, PX_PER_MM_ACTUAL, 0.5, 12);
        break;
      case "grid":
        this.#grid = value !== null && value !== "false";
        break;
      case "label":
        if (value) this.#input.setAttribute("aria-label", value);
        else this.#input.removeAttribute("aria-label");
        break;
    }
    this.#schedule();
  }

  // -------------------------------------------------------------------------
  // Public API

  get value(): string {
    return this.#input.value;
  }

  set value(text: string) {
    this.#setInputValue(String(text ?? ""));
    this.#schedule();
  }

  get selectionStart(): number {
    return this.#input.selectionStart;
  }

  get selectionEnd(): number {
    return this.#input.selectionEnd;
  }

  /** The rendering in use: "3d", "flat", or null while undecided. */
  get render(): A4Render | null {
    return this.#reported;
  }

  /** Cells in `text`'s grid on the current preset. */
  #cellCount(text: string): number {
    const { cols, rows } = this.#spec;
    return Math.max(rows, layoutRows(text, cols).length) * cols;
  }

  /**
   * Set a named plane of per-cell values for a model lens. Throws RangeError
   * when the value count doesn't match the plane text's grid.
   */
  setPlane(name: string, plane: A4Plane) {
    if (!name) throw new RangeError("A plane needs a name.");
    const expected = this.#cellCount(plane.text);
    if (!(plane.values instanceof Float32Array) || plane.values.length !== expected) {
      throw new RangeError(`Plane "${name}" has ${plane.values?.length ?? 0} values; its text's grid has ${expected} cells.`);
    }
    this.#planes.set(name, { text: plane.text, values: plane.values, label: plane.label ?? name, cols: this.#spec.cols });
    this.#schedule();
  }

  removePlane(name: string) {
    if (this.#planes.delete(name)) this.#schedule();
  }

  /** Names of the planes set on this sheet. */
  get planeNames(): string[] {
    return [...this.#planes.keys()];
  }

  /** The active model lens's values, if they still describe this exact text. */
  #heat(text: string): { values: Float32Array; cols: number } | undefined {
    if (!this.#modelLens) return undefined;
    const plane = this.#planes.get(this.#modelLens);
    if (!plane || plane.text !== text || plane.cols !== this.#spec.cols) return undefined;
    if (plane.values.length !== this.#cellCount(text)) return undefined;
    return { values: plane.values, cols: plane.cols };
  }

  setSelectionRange(start: number, end: number, direction?: "forward" | "backward" | "none") {
    this.#input.setSelectionRange(start, end, direction);
    this.#schedule();
  }

  override focus(options?: FocusOptions) {
    this.#input.focus({ preventScroll: true, ...options });
  }

  /** Play the letter-fold animation (or toggle the pose with reduced motion). */
  fold() {
    this.#stopAnimation();
    if (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const folded = this.#pose.foldBottom === 1 && this.#pose.foldTop === 1;
      this.#pose = folded ? FLAT : { foldBottom: 1, foldTop: 1, curl: 0 };
      this.#emitPose();
      this.#schedule();
      return;
    }
    const started = performance.now();
    const step = (now: number) => {
      const t = (now - started) / 1000;
      this.#pose = foldPoseAt(t);
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

  #setInputValue(text: string) {
    this.#valueInitialized = true;
    if (this.#input.value === text) return;
    const { selectionStart: s, selectionEnd: e } = this.#input;
    this.#input.value = text;
    const max = text.length;
    this.#input.setSelectionRange(Math.min(s, max), Math.min(e, max));
  }

  #stopAnimation() {
    if (this.#animation) cancelAnimationFrame(this.#animation);
    this.#animation = 0;
  }

  #emitPose() {
    this.dispatchEvent(new CustomEvent("a4-posechange", { bubbles: true, composed: true, detail: { ...this.#pose } }));
  }

  #effectiveRender(): A4Render {
    if (this.#request === "flat" || this.#gpu === "unavailable") return "flat";
    return "3d";
  }

  #applyRender() {
    if (!this.isConnected) return;
    const render = this.#effectiveRender();
    this.#stage.dataset.render = render;
    if (render === "3d" && !this.#renderer && !this.#creating && this.#gpu !== "unavailable") {
      this.#creating = true;
      PaperRenderer.create(this.#gpuCanvas)
        .then((renderer) => {
          if (!this.isConnected) {
            renderer.destroy();
            return;
          }
          this.#renderer = renderer;
          this.#gpu = "ok";
        })
        .catch(() => {
          this.#gpu = "unavailable";
        })
        .finally(() => {
          this.#creating = false;
          this.#applyRender();
        });
    }
    // Report only settled renderings: 3D once the renderer exists, or flat.
    const settled: A4Render | null = render === "flat" ? "flat" : this.#renderer ? "3d" : null;
    if (settled && settled !== this.#reported) {
      this.#reported = settled;
      this.dispatchEvent(new CustomEvent("a4-render", { bubbles: true, composed: true, detail: settled }));
    }
    this.#schedule();
  }

  #loadFonts() {
    const family = getComputedStyle(this).getPropertyValue("--a4-font").trim();
    if (family) this.#fontFamily = family;
    if (this.#fontsRequested || typeof document.fonts === "undefined") return;
    this.#fontsRequested = true;
    Promise.all([document.fonts.load(`400 16px ${this.#fontFamily}`), document.fonts.load(`600 16px ${this.#fontFamily}`)])
      .catch(() => {})
      .finally(() => this.#schedule());
  }

  #getAnalysis(): Analysis {
    const text = this.#input.value;
    if (!this.#analysis || this.#analysis.text !== text || this.#analysis.spec !== this.#spec) {
      this.#analysis = { text, spec: this.#spec, result: analyze(text, this.#spec) };
    }
    return this.#analysis.result;
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
    if (this.#zoom) return this.#zoom;
    const width = this.clientWidth || PAPER_W * PX_PER_MM_ACTUAL;
    return Math.max(1, Math.min(PX_PER_MM_ACTUAL, width / PAPER_W));
  }

  #layoutInput(scale: number, rowsTotal: number) {
    const spec = this.#spec;
    const s = this.#input.style;
    s.left = `${spec.marginX * scale}px`;
    s.top = `${spec.marginY * scale}px`;
    // Half a cell of slack absorbs float drift without admitting column cols + 1.
    s.width = `${(spec.cols + 0.5) * spec.cellW * scale}px`;
    s.height = `${Math.max(spec.rows, rowsTotal) * spec.cellH * scale}px`;
    s.fontSize = `${fontSizeMm(spec) * scale}px`;
    s.lineHeight = `${spec.cellH * scale}px`;
  }

  #paint() {
    if (!this.isConnected) return;
    const analysis = this.#getAnalysis();
    const text = this.#input.value;
    const focused = this.#root.activeElement === this.#input;
    const selection = { start: this.#input.selectionStart, end: this.#input.selectionEnd, focused };
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const scale = this.#flatScale();
    const render = this.#effectiveRender();

    this.#layoutInput(scale, analysis.rowsTotal);
    // Kept current while editing, so printing works even where beforeprint never fires.
    this.#fillPrint();

    if (render === "flat") {
      const { heightMm } = paintPage(this.#pageCanvas, {
        text,
        spec: this.#spec,
        analysis,
        lens: this.#lens,
        fontFamily: this.#fontFamily,
        pxPerMm: scale * dpr,
        selection,
        overflow: true,
        grid: this.#grid,
        chrome: "flat",
        heat: this.#heat(text),
      });
      const w = `${PAPER_W * scale}px`;
      this.#flat.style.width = w;
      this.#flat.style.height = `${heightMm * scale}px`;
      this.#paper.style.width = w;
      this.#paper.style.height = `${PAPER_H * scale}px`;
      this.#pageCanvas.style.width = w;
      this.#pageCanvas.style.height = `${heightMm * scale}px`;
      return;
    }

    const renderer = this.#renderer;
    if (!renderer) return;
    renderer.setDeskColor(cssColor(getComputedStyle(this).getPropertyValue("--a4-desk"), [0.91, 0.9, 0.87]));
    renderer.resize();
    const heightPx = this.#gpuCanvas.clientHeight * Math.min(2, dpr);
    paintPage(this.#texture, {
      text,
      spec: this.#spec,
      analysis,
      lens: this.#lens,
      fontFamily: this.#fontFamily,
      pxPerMm: Math.min(10, Math.max(5, Math.ceil((heightPx / PAPER_H) * 1.3))),
      selection,
      grid: this.#grid,
      chrome: "texture",
      heat: this.#heat(text),
    });
    renderer.setPage(this.#texture);
    renderer.setPose(this.#pose);
    renderer.setView(this.#view);
    renderer.setZoom(this.#zoom);
    renderer.render();
  }

  /** Rebuild the print layer when the text or grid changed since the last fill. */
  #fillPrint() {
    const spec = this.#spec;
    const analysis = this.#getAnalysis();
    if (this.#printed === analysis) return;
    this.#printed = analysis;
    this.#print.replaceChildren(
      ...printRows(analysis.rows, this.#input.value, spec).map((row) => {
        const div = document.createElement("div");
        div.textContent = row.text;
        div.style.left = `${spec.marginX}mm`;
        div.style.top = `${row.topMm}mm`;
        div.style.fontSize = `${fontSizeMm(spec)}mm`;
        div.style.lineHeight = `${spec.cellH}mm`;
        return div;
      }),
    );
  }

  #offsetAt(clientX: number, clientY: number): number | null {
    const hit = this.#renderer?.pick(clientX, clientY);
    if (!hit) return null;
    const cell = cellAt(hit.x, hit.y, this.#spec);
    if (!cell) return null;
    const analysis = this.#getAnalysis();
    return caretOffset(analysis.rows, this.#input.value.length, cell.row, cell.col);
  }

  #pointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    try {
      this.#gpuCanvas.setPointerCapture(e.pointerId);
    } catch {
      // The pointer is already gone (canceled touch, synthetic event); drag without capture.
    }
    const offset = this.#offsetAt(e.clientX, e.clientY);
    if (offset !== null) {
      e.preventDefault();
      this.#input.focus({ preventScroll: true });
      this.#input.setSelectionRange(offset, offset);
      this.#drag = { kind: "select", anchor: offset };
      this.#schedule();
    } else {
      this.#drag = { kind: "orbit", x: e.clientX, y: e.clientY, tilt: this.#view.tilt, yaw: this.#view.yaw };
      this.#gpuCanvas.style.cursor = "grabbing";
    }
  }

  #pointerMove(e: PointerEvent) {
    const d = this.#drag;
    if (!d) {
      this.#gpuCanvas.style.cursor = this.#offsetAt(e.clientX, e.clientY) !== null ? "text" : "grab";
      return;
    }
    if (d.kind === "select") {
      const offset = this.#offsetAt(e.clientX, e.clientY);
      if (offset === null) return;
      const [a, b] = offset < d.anchor ? [offset, d.anchor] : [d.anchor, offset];
      this.#input.setSelectionRange(a, b, offset < d.anchor ? "backward" : "forward");
      this.#schedule();
      return;
    }
    const yaw = ((((d.yaw + (e.clientX - d.x) * 0.3 + 180) % 360) + 360) % 360) - 180;
    const tilt = Math.max(0, Math.min(65, d.tilt + (e.clientY - d.y) * 0.25));
    this.#view = { ...this.#view, tilt, yaw };
    this.#schedule();
    this.dispatchEvent(new CustomEvent("a4-viewchange", { bubbles: true, composed: true, detail: { tilt, turn: yaw } }));
  }

  #pointerUp() {
    if (this.#drag?.kind === "orbit") this.#gpuCanvas.style.cursor = "grab";
    this.#drag = null;
  }
}

/** Register <a4-sheet> (safe to call more than once). */
export function defineA4Sheet(name = "a4-sheet"): void {
  if (typeof customElements !== "undefined" && !customElements.get(name)) {
    customElements.define(name, A4SheetElement);
  }
}
