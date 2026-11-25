/**
 * What the UI may do with the app's plugin registry (lib/models/registry.ts),
 * as an interface, so components can hold the registry they import
 * dynamically without importing its module.
 */

import type { ModelHost } from "./host.ts";
import type { DamagedPlugin, InstalledPlugin, Inspection } from "./installed.ts";

export interface PluginRegistryApi {
  readonly host: ModelHost;
  load(): Promise<void>;
  installed(): InstalledPlugin[];
  damaged(): readonly DamagedPlugin[];
  sandboxWorks(): Promise<boolean>;
  inspect(bytes: Uint8Array, sourceUrl?: string): Promise<Inspection>;
  inspectUrl(url: string, signal?: AbortSignal): Promise<Inspection>;
  checkForUpdate(id: string, signal?: AbortSignal): Promise<Inspection>;
  install(inspection: Inspection): Promise<InstalledPlugin>;
  remove(id: string): Promise<void>;
}
