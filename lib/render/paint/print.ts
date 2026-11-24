/** The print layer's rows: the page's visual rows (no overflow), as text at their top offset in mm. */

import { rowTop, type PageSpec, type VisualRow } from "../../page/index.ts";

export interface PrintRow {
  readonly topMm: number;
  readonly text: string;
}

export function printRows(rows: readonly VisualRow[], text: string, spec: PageSpec): PrintRow[] {
  return rows.slice(0, spec.rows).map((r, i) => ({ topMm: rowTop(spec, i), text: text.slice(r.start, r.end) }));
}
