/**
 * Trash ids: "<name>.<trashedAt>", the trashed page's name and the epoch
 * milliseconds it was trashed. Ids from older versions may lack the time.
 */

import { storedPageName } from "./names.ts";
import type { PageName, TrashId } from "./types.ts";

export interface TrashIdParts {
  readonly id: TrashId;
  /** The page's name when it was trashed. */
  readonly name: PageName;
  /** Epoch milliseconds, or 0 when the id doesn't record it. */
  readonly trashedAt: number;
}

/** Read a stored trash id; null when it names no page (skip the entry). */
export function parseTrashId(value: string): TrashIdParts | null {
  const m = /^(.*)\.(\d+)$/.exec(value);
  const name = storedPageName(m?.[1] ?? value);
  if (!name) return null;
  return { id: value as TrashId, name, trashedAt: m ? Number(m[2]) : 0 };
}

/** A new id for `name` trashed at `at`, moved later by a millisecond while `taken`. */
export function makeTrashId(name: PageName, at: number, taken: (id: string) => boolean): TrashIdParts {
  let t = at;
  while (taken(`${name}.${t}`)) t++;
  return { id: `${name}.${t}` as TrashId, name, trashedAt: t };
}
