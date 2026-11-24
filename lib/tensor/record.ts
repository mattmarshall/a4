/**
 * `a4.v1.Sheet` records: a page's spec, text, and grid, as protobuf bytes for
 * anything that crosses a worker, process, or file boundary. Readers verify
 * the grid is exactly the encoding of the text.
 */

import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { PageSpecSchema, SheetSchema, type PageSpec as PageSpecMessage, type Sheet } from "../gen/a4/v1/sheet_pb.js";
import type { PageSpec } from "../page/index.ts";
import { encodeGrid, firstDifferingRow } from "./codec.ts";

/** A sheet record that is malformed or whose grid doesn't match its text. */
export class SheetRecordError extends Error {
  /** The first row that differs, when the grid doesn't match the text. */
  readonly row: number | null;
  constructor(message: string, row: number | null = null) {
    super(message);
    this.name = "SheetRecordError";
    this.row = row;
  }
}

/** The protobuf form of a page spec. */
export function pageSpecMessage(spec: PageSpec): PageSpecMessage {
  return create(PageSpecSchema, {
    preset: spec.id,
    cols: spec.cols,
    rows: spec.rows,
    cellWMm: spec.cellW,
    cellHMm: spec.cellH,
    marginXMm: spec.marginX,
    marginYMm: spec.marginY,
  });
}

/** Build a sheet record for `text` on `spec`. */
export function sheetRecord(text: string, spec: PageSpec): Sheet {
  return create(SheetSchema, { spec: pageSpecMessage(spec), text, grid: encodeGrid(text, spec) });
}

/** Throw unless the record has a spec and a grid that encodes its text exactly. */
export function verifySheet(sheet: Sheet): void {
  const { spec, grid } = sheet;
  if (!spec || spec.cols < 1) throw new SheetRecordError("sheet record has no page spec");
  if (!grid) throw new SheetRecordError("sheet record has no grid");
  const expected = encodeGrid(sheet.text, { cols: spec.cols, rows: spec.rows });
  const row = firstDifferingRow(grid, expected);
  if (row >= 0) throw new SheetRecordError(`sheet record grid does not match its text at row ${row}`, row);
}

/**
 * Serialize a sheet record. Protobuf strings are UTF-8, so text with a lone
 * surrogate can't be written faithfully and is refused.
 */
export function writeSheet(sheet: Sheet): Uint8Array {
  if (!sheet.text.isWellFormed())
    throw new SheetRecordError("sheet text contains a lone surrogate and can't be stored as UTF-8");
  verifySheet(sheet);
  return toBinary(SheetSchema, sheet);
}

/** Parse and verify a sheet record. */
export function readSheet(bytes: Uint8Array): Sheet {
  let sheet: Sheet;
  try {
    sheet = fromBinary(SheetSchema, bytes);
  } catch (error) {
    throw new SheetRecordError(`not a sheet record: ${error instanceof Error ? error.message : String(error)}`);
  }
  verifySheet(sheet);
  return sheet;
}
