/**
 * A plugin's descriptor: its static card and the typed names of what it
 * returns (planes, scores, finding kinds, instructions). Light, so the UI,
 * the host, and the plugin's own implementation can all import it without
 * loading any model code.
 */

import type { ModelCard } from "../gen/a4/v1/model_pb.js";
import type { PluginId } from "./plugin-id.ts";

export interface PluginDescriptor {
  readonly id: PluginId;
  readonly card: ModelCard;
  /**
   * True when the card declares a download (`download_bytes > 0`): the
   * manifest then requires a check for whether it's already in this browser.
   */
  readonly downloads: boolean;
  /** The plugin's typed names: planes, scores, finding kinds, instructions. */
  readonly names: Readonly<Record<string, unknown>>;
}
