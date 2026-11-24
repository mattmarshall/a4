/** A plugin's incoming sheet, checked at the boundary before the plugin reads it. */

import type { PageSpec, Sheet } from "../gen/a4/v1/sheet_pb.js";
import { verifySheet } from "../tensor/record.ts";
import { ErrorCode, ModelError } from "./errors.ts";

/** Verify `sheet`, and return its spec and text (the plugin reads the text view). */
export function readTextSheet(sheet: Sheet | undefined, who: string): { text: string; spec: PageSpec } {
  if (!sheet?.spec) throw new ModelError(ErrorCode.INVALID_RESULT, `${who} needs a sheet with a page spec.`);
  try {
    verifySheet(sheet);
  } catch (error) {
    throw new ModelError(
      ErrorCode.INVALID_RESULT,
      `${who} got a sheet that doesn't check out: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (sheet.text === undefined) throw new ModelError(ErrorCode.INVALID_RESULT, `${who} needs the page text.`);
  return { text: sheet.text, spec: sheet.spec };
}
