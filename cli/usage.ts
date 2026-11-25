/** What every `a4` command shares: the usage error and how paths are shown. */

import { sep } from "node:path";

/** A usage error or an unreadable path: exit status 2. */
export class UsageError extends Error {}

/** A path for display and globs: "/"-separated, without a leading "./". */
export function slashed(path: string): string {
  return path.split(sep).join("/").replace(/^\.\//, "");
}
