/**
 * Test-only: brand a string without validating it, to check that a backend
 * rejects an invalid identifier that reaches it anyway. These are the only
 * brand casts outside the parsers (see scripts/cast-report.ts).
 */

import type { FilePath } from "../refs.ts";
import type { PageName } from "../types.ts";

export function forgePageName(value: string): PageName {
  return value as PageName;
}

export function forgeFilePath(value: string): FilePath {
  return value as FilePath;
}
