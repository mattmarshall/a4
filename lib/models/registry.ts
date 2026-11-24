/**
 * The app's model host, built from the manifest (lib/models/manifest.ts).
 * The UI imports this module dynamically, so the host and its transports load
 * only when models are used.
 */

import { ModelHost } from "./host.ts";
import { MANIFEST, type PluginDefinition } from "./manifest.ts";

/** A host with every plugin in `manifest` registered. */
export function createHost(manifest: readonly PluginDefinition[] = MANIFEST): ModelHost {
  const host = new ModelHost();
  for (const plugin of manifest) host.register({ card: plugin.descriptor.card, connect: plugin.connect });
  return host;
}

let host: ModelHost | null = null;

/** The app's one model host, with every bundled plugin registered. */
export function modelHost(): ModelHost {
  host ??= createHost();
  return host;
}
