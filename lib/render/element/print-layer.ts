/**
 * The print layer: the page's rows as plain text positioned in millimeters,
 * shown only by the print stylesheet. Rebuilt when the browser is idle after
 * the text changes, and at once when printing starts (beforeprint, or the
 * print media query, for browsers that skip beforeprint).
 */

import { fontSizeMm } from "../../page/index.ts";
import type { PageModel } from "../paint/model.ts";
import { printRows } from "../paint/print.ts";

type IdleWindow = Window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};

export class PrintLayer {
  readonly element: HTMLDivElement;
  #pending: PageModel | null = null;
  #shown: { readonly text: string; readonly rows: PageModel["rows"] } | null = null;
  #idle: { cancel(): void } | null = null;
  #printQuery: MediaQueryList | null = null;
  readonly #flush = () => this.flush();
  readonly #onPrintQuery = (e: MediaQueryListEvent) => {
    if (e.matches) this.flush();
  };

  constructor() {
    this.element = document.createElement("div");
    this.element.className = "print";
    this.element.setAttribute("aria-hidden", "true");
  }

  connect(): void {
    window.addEventListener("beforeprint", this.#flush);
    if (typeof matchMedia === "function") {
      this.#printQuery = matchMedia("print");
      this.#printQuery.addEventListener("change", this.#onPrintQuery);
    }
  }

  disconnect(): void {
    window.removeEventListener("beforeprint", this.#flush);
    this.#printQuery?.removeEventListener("change", this.#onPrintQuery);
    this.#printQuery = null;
    this.#idle?.cancel();
    this.#idle = null;
  }

  /** Note the page to print; it's laid out when the browser is next idle. */
  update(model: PageModel): void {
    this.#pending = model;
    if (this.#idle || this.#isShown(model)) return;
    const w = window as IdleWindow;
    if (w.requestIdleCallback && w.cancelIdleCallback) {
      const cancelIdle = w.cancelIdleCallback;
      const handle = w.requestIdleCallback(this.#flush, { timeout: 1000 });
      this.#idle = { cancel: () => cancelIdle(handle) };
    } else {
      const handle = setTimeout(this.#flush, 200);
      this.#idle = { cancel: () => clearTimeout(handle) };
    }
  }

  /** Lay out the latest page now. */
  flush(): void {
    this.#idle?.cancel();
    this.#idle = null;
    const model = this.#pending;
    if (!model || this.#isShown(model)) return;
    this.#shown = { text: model.text, rows: model.rows };
    const { spec } = model;
    this.element.replaceChildren(
      ...printRows(model.rows, model.text, spec).map((row) => {
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

  #isShown(model: PageModel): boolean {
    return this.#shown?.text === model.text && this.#shown.rows === model.rows;
  }
}
