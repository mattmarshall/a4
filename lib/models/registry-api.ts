/**
 * What the UI may do with the app's plugin registry (lib/models/registry.ts),
 * as an interface, so components can hold the registry they import
 * dynamically without importing its module.
 */

import type { ModelHost } from "./host.ts";
import type { DamagedPlugin, InstalledPlugin, Inspection } from "./installed.ts";
import type { PluginId } from "./plugin-id.ts";

export interface PluginRegistryApi {
  readonly host: ModelHost;
  load(): Promise<void>;
  installed(): InstalledPlugin[];
  damaged(): readonly DamagedPlugin[];
  /** Call `listener` after the installed or damaged plugins change, in this tab or another. Returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
  sandboxWorks(): Promise<boolean>;
  inspect(bytes: Uint8Array, sourceUrl?: string): Promise<Inspection>;
  inspectUrl(url: string, signal?: AbortSignal): Promise<Inspection>;
  checkForUpdate(id: PluginId, signal?: AbortSignal): Promise<Inspection>;
  install(inspection: Inspection): Promise<InstalledPlugin>;
  remove(id: PluginId): Promise<void>;
  /** Remove a stored plugin that failed its checks, by the id it's stored under. */
  removeDamaged(id: string): Promise<void>;
}
