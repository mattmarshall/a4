/** Reading a card: where its plugin sends text, and how a plane's values map to its tint. */

import type { ModelCard, PlaneInfo } from "../gen/a4/v1/model_pb.js";

/** Where a remote plugin sends page text, or null when the text stays on the device. */
export function remoteHost(card: ModelCard): string | null {
  return card.placement.case === "remote" ? card.placement.value.destinationHost : null;
}

export type { PlaneInfo } from "../gen/a4/v1/model_pb.js";

/** A value's tint level on a plane: 0 at or below `min`, 1 at `max`. */
export function planeLevel(plane: Pick<PlaneInfo, "min" | "max">, value: number): number {
  const span = plane.max - plane.min;
  if (!(span > 0)) return value >= plane.max ? 1 : 0;
  return Math.min(1, Math.max(0, (value - plane.min) / span));
}
