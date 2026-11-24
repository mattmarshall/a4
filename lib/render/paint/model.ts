/**
 * What the painter draws: the page's rows and line kinds, the active lens's
 * style for each character, and a model plane. Built from the text without
 * the full analysis (no metrics or verdict), so the element paints without
 * running `analyze()`.
 */

import { pageLayout, segmentsFor, type LineKind, type SegmentStyle } from "../../analysis/index.ts";
import { rowsUsed, type LensId, type PageSpec, type VisualRow } from "../../page/index.ts";

/** A model lens's values: one in [0, 1] per cell, row-major, `cols` wide. */
export interface PagePlane {
  readonly values: Float32Array;
  readonly cols: number;
}

export interface PageModel {
  readonly text: string;
  readonly spec: PageSpec;
  /** The text's visual rows on `spec`, including any past the page. */
  readonly rows: readonly VisualRow[];
  /** One kind per logical line. */
  readonly lineKinds: readonly LineKind[];
  /** Rows that hold text past the page's last row (0 when it fits). */
  readonly overflow: number;
  readonly lens: LensId;
  /** The lens's style for each character of `text` (undefined: plain ink). */
  readonly styles: readonly (SegmentStyle | undefined)[];
  /** The model lens shown, if any. */
  readonly plane: PagePlane | undefined;
}

/** Each character's segment style, from the lens's segments. */
function charStyles(
  lens: LensId,
  text: string,
  source: Parameters<typeof segmentsFor>[2],
): (SegmentStyle | undefined)[] {
  const styles: (SegmentStyle | undefined)[] = new Array(text.length);
  let offset = 0;
  for (const seg of segmentsFor(lens, text, source)) {
    for (let i = 0; i < seg.text.length; i++) styles[offset + i] = seg.style;
    offset += seg.text.length;
  }
  return styles;
}

export function pageModel(text: string, spec: PageSpec, lens: LensId, plane?: PagePlane): PageModel {
  const layout = pageLayout(text, spec);
  return {
    text,
    spec,
    rows: layout.rows,
    lineKinds: layout.lineKinds,
    overflow: Math.max(0, rowsUsed(layout.rows) - spec.rows),
    lens,
    styles: charStyles(lens, text, { layout }),
    plane,
  };
}

/** The same page with another plane (the layout and styles are reused). */
export function withPlane(model: PageModel, plane: PagePlane | undefined): PageModel {
  return model.plane === plane ? model : { ...model, plane };
}
