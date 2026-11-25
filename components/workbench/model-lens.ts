/**
 * Model lenses: one for each plane an overlay declares, from Semantic
 * repetition or an installed plugin. A plane's key names its plugin and
 * plane, so two plugins' planes never collide. An overlay that keeps text on
 * the device rescores while the author types; one that sends text away
 * scores only when the author asks, with consent each time.
 */

import { type ModelCard, Operation, type PluginId, pluginIdOf, remoteHost } from "../../lib/models/index.ts";
import type { ModelLegend } from "../MetricsPanel";

/** A plane the lens bar offers. */
export interface LensSource {
  readonly pluginId: PluginId;
  readonly plane: string;
  readonly label: string;
  readonly card: ModelCard;
  /** Who published it, for an installed plugin; null for a bundled one. */
  readonly publisher: string | null;
}

/** The key a plane's values are kept and shown under: its plugin and its name. */
export const planeKey = (pluginId: PluginId, plane: string) => `${pluginId}/${plane}`;

/** Whether a plugin's lens rescores while the author types: only when page text stays on the device. */
export const rescoresWhileTyping = (card: ModelCard) => remoteHost(card) === null;

/** The lens sources from `cards`: each scoring card's planes, with its publisher when it has one. */
export function lensSources(
  cards: readonly { readonly card: ModelCard; readonly publisher: string | null }[],
): LensSource[] {
  return cards.flatMap(({ card, publisher }) =>
    card.operations.includes(Operation.SCORE)
      ? (card.score?.planes ?? []).map((plane) => ({
          pluginId: pluginIdOf(card),
          plane: plane.name,
          label: plane.label || plane.name,
          card,
          publisher,
        }))
      : [],
  );
}

/** A plane's legend, from its card: its scale, what marked values mean, and who made it. */
export function legendOf(source: LensSource): ModelLegend | null {
  const plane = source.card.score?.planes.find((p) => p.name === source.plane);
  if (!plane) return null;
  const marks = plane.legend.map((stop) => `${stop.value.toFixed(2)} or more ${stop.label}.`);
  const scale = `${plane.quantity ? `${plane.quantity} ` : ""}${plane.min.toFixed(2)} → ${plane.max.toFixed(2)}`;
  return {
    plane: plane.label || plane.name,
    plugin: source.card.name,
    ...(source.card.model ? { model: source.card.model } : {}),
    scale,
    ...([plane.description, ...marks].filter(Boolean).length
      ? { note: [plane.description, ...marks].filter(Boolean).join(" ") }
      : {}),
    ...(source.publisher ? { publisher: source.publisher } : {}),
  };
}
