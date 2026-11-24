/**
 * Plugin ids: branded, and minted only from a card, so a typo or a plain
 * string can't be passed where a plugin is meant. The host returns the id
 * when it registers a card; each bundled card's module exports its own.
 */

import type { ModelCard } from "../gen/a4/v1/model_pb.js";

declare const pluginIdBrand: unique symbol;

export type PluginId = string & { readonly [pluginIdBrand]: true };

/** The id of `card`. */
export function pluginIdOf(card: ModelCard): PluginId {
  return card.id as PluginId;
}
