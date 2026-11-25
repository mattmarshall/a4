/**
 * The letter-fold animation: fold the bottom third up, fold the top third
 * down, hold, then unfold in reverse. Time-based, so dropped frames skip ahead
 * rather than slowing the animation.
 */

import { FLAT, type Pose } from "./deform.ts";

/** Phase lengths in seconds. */
export const FOLD_TIMELINE = { bottom: 0.9, top: 0.9, hold: 1.1 } as const;

export const FOLD_DURATION = 2 * (FOLD_TIMELINE.bottom + FOLD_TIMELINE.top) + FOLD_TIMELINE.hold;

function easeInOut(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c < 0.5 ? 4 * c * c * c : 1 - (-2 * c + 2) ** 3 / 2;
}

/** Pose at `t` seconds into the fold animation (flat before 0 and after the end). */
export function foldPoseAt(t: number): Pose {
  const { bottom, top, hold } = FOLD_TIMELINE;
  if (t <= 0 || t >= FOLD_DURATION) return FLAT;
  const foldIn = bottom + top;
  if (t <= bottom) return { foldBottom: easeInOut(t / bottom), foldTop: 0, curl: 0 };
  if (t <= foldIn) return { foldBottom: 1, foldTop: easeInOut((t - bottom) / top), curl: 0 };
  if (t <= foldIn + hold) return { foldBottom: 1, foldTop: 1, curl: 0 };
  const out = t - foldIn - hold;
  if (out <= top) return { foldBottom: 1, foldTop: 1 - easeInOut(out / top), curl: 0 };
  return { foldBottom: 1 - easeInOut((out - top) / bottom), foldTop: 0, curl: 0 };
}
