/**
 * The React wrapper's bookkeeping for <a4-sheet>, pure so Node tests it:
 * which planes to set or remove, and which attributes to write.
 */

import type { A4Plane } from "../lib/render/index.ts";

export interface PlaneDiff {
  /** New planes, and planes whose object changed. */
  readonly set: readonly (readonly [string, A4Plane])[];
  /** Planes the sheet shows that are no longer wanted. */
  readonly remove: readonly string[];
}

/** The planes to set (new or changed, by identity) and to remove, given what the sheet shows. */
export function diffPlanes(
  next: Readonly<Record<string, A4Plane>> | undefined,
  shown: ReadonlyMap<string, A4Plane>,
): PlaneDiff {
  const wanted = next ?? {};
  return {
    set: Object.entries(wanted).filter(([name, plane]) => shown.get(name) !== plane),
    remove: [...shown.keys()].filter((name) => !Object.hasOwn(wanted, name)),
  };
}

/**
 * The attribute writes for the props' attributes: each one whose value
 * differs from what the wrapper last wrote. It doesn't compare with the
 * element's current attribute, because that is only the requested value: after
 * the user orbits or folds, a prop that asks for the attribute's value again
 * must still be written, and the sheet applies it.
 */
export function attributeWrites<N extends string>(
  next: ReadonlyMap<N, string | null>,
  written: ReadonlyMap<N, string | null>,
): [N, string | null][] {
  return [...next].filter(([name, value]) => !written.has(name) || written.get(name) !== value);
}
