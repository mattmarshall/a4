/**
 * Flat rendering: the painted page on a canvas, on a paper-colored sheet,
 * under the editor's transparent textarea. Repaints only when what it shows
 * changed (the selection is the textarea's own, so it never repaints this).
 */

import type { PageModel } from "../paint/model.ts";
import { paintPage } from "../paint/page.ts";

export interface FlatSettings {
  /** CSS px per mm. */
  readonly scale: number;
  /** Canvas px per mm (the scale times the device pixel ratio). */
  readonly pxPerMm: number;
  readonly fontFamily: string;
  readonly grid: boolean;
}

const NO_SELECTION = { start: 0, end: 0, focused: false } as const;

export class FlatView {
  /** The flat sheet: paper, page canvas, and the textarea on top. */
  readonly element: HTMLDivElement;
  readonly #paper: HTMLDivElement;
  readonly #page: HTMLCanvasElement;
  #shown: { readonly model: PageModel; readonly settings: FlatSettings } | null = null;

  constructor(input: HTMLTextAreaElement) {
    this.element = document.createElement("div");
    this.element.className = "flat";
    this.#paper = document.createElement("div");
    this.#paper.className = "paper";
    this.#page = document.createElement("canvas");
    this.#page.className = "page";
    this.#page.setAttribute("aria-hidden", "true");
    for (const node of [this.#paper, this.#page, input]) this.element.appendChild(node);
  }

  draw(model: PageModel, settings: FlatSettings): void {
    const shown = this.#shown;
    if (
      shown?.model === model &&
      shown.settings.scale === settings.scale &&
      shown.settings.pxPerMm === settings.pxPerMm &&
      shown.settings.fontFamily === settings.fontFamily &&
      shown.settings.grid === settings.grid
    ) {
      return;
    }
    this.#shown = { model, settings };
    const { heightMm } = paintPage(this.#page, model, {
      fontFamily: settings.fontFamily,
      pxPerMm: settings.pxPerMm,
      selection: NO_SELECTION,
      overflow: true,
      grid: settings.grid,
      chrome: "flat",
    });
    const { scale } = settings;
    const { paperW, paperH } = model.spec;
    const width = `${paperW * scale}px`;
    const height = `${heightMm * scale}px`;
    this.element.style.width = width;
    this.element.style.height = height;
    this.#paper.style.width = width;
    this.#paper.style.height = `${paperH * scale}px`;
    this.#page.style.width = width;
    this.#page.style.height = height;
  }

  /** Forget what was painted, so the next draw repaints (fonts loaded, say). */
  invalidate(): void {
    this.#shown = null;
  }
}
