/**
 * The bundled plugins: the only place a plugin is registered. Each entry is a
 * light descriptor plus lazy thunks. `connect` loads the implementation on
 * first use; `isDownloaded` checks whether a downloaded model is already in
 * this browser without starting it. The registry, the card list, and the
 * download checks all derive from this list. Only these plugins run: the
 * host never loads plugin code from page content, imports, or URLs.
 *
 * On the server, vite.config.ts swaps each plugin's connect.ts for a stub, so
 * no implementation (or its model runtime) is bundled there.
 */

import type { ModelCard } from "../gen/a4/v1/model_pb.js";
import type { SheetModelClient } from "./client.ts";
import type { PluginContext } from "./host.ts";
import type { PluginDescriptor } from "./descriptor.ts";
import { ErrorCode, ModelError } from "./errors.ts";
import { FIT_TO_PAGE } from "./plugins/fit/descriptor.ts";
import { SEMANTIC_REPETITION } from "./plugins/semantic/descriptor.ts";
import type { PluginId } from "./plugin-id.ts";

export interface PluginDefinition {
  readonly descriptor: PluginDescriptor;
  /** Load the implementation and connect to it, with the host's getter for credentials. */
  readonly connect: (context: PluginContext) => Promise<SheetModelClient>;
  /** Whether a downloaded model is already in this browser; absent when nothing downloads. */
  readonly isDownloaded?: () => Promise<boolean>;
}

/** A plugin that downloads must say how to tell it's downloaded. */
type DownloadCheck<D extends PluginDescriptor> = D["downloads"] extends true
  ? { readonly isDownloaded: () => Promise<boolean> }
  : { readonly isDownloaded?: never };

/** Register a plugin: its descriptor and its lazy thunks. */
export function definePlugin<D extends PluginDescriptor>(
  plugin: {
    readonly descriptor: D;
    readonly connect: (context: PluginContext) => Promise<SheetModelClient>;
  } & DownloadCheck<D>,
): PluginDefinition {
  const { descriptor } = plugin;
  if (descriptor.downloads !== descriptor.card.downloadBytes > 0) {
    throw new ModelError(
      ErrorCode.INVALID_CARD,
      `Plugin "${descriptor.id}": "downloads" must match the card's download size.`,
    );
  }
  return plugin;
}

export const MANIFEST: readonly PluginDefinition[] = [
  definePlugin({
    descriptor: SEMANTIC_REPETITION,
    connect: async () => (await import("./plugins/semantic/connect.ts")).connect(),
    isDownloaded: async () => (await import("./plugins/semantic/cache.ts")).semanticModelCached(),
  }),
  definePlugin({
    descriptor: FIT_TO_PAGE,
    connect: async (context) => (await import("./plugins/fit/connect.ts")).connect(context),
  }),
];

/** The cards of `manifest`, in order. */
export function cardsOf(manifest: readonly PluginDefinition[]): readonly ModelCard[] {
  return manifest.map((p) => p.descriptor.card);
}

/** Every bundled plugin's card, importable without loading any plugin code. */
export const BUNDLED_CARDS: readonly ModelCard[] = cardsOf(MANIFEST);

/** True when the card declares a download, whatever it sends where. */
export function needsDownload(card: ModelCard): boolean {
  return card.downloadBytes > 0;
}

/**
 * Whether plugin `id`'s model is already downloaded. A plugin without a check
 * counts as not downloaded, so the page never starts a model it can't vouch for.
 */
export async function isDownloaded(id: PluginId, manifest: readonly PluginDefinition[] = MANIFEST): Promise<boolean> {
  const check = manifest.find((p) => p.descriptor.id === id)?.isDownloaded;
  if (!check) return false;
  try {
    return await check();
  } catch {
    return false;
  }
}
