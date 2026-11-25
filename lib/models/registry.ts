/**
 * The app's model host, built from the manifest (lib/models/manifest.ts),
 * with the author's installed plugins registered beside the bundled ones
 * (README, "Third-party plugins"). The UI imports this module dynamically, so
 * the host, its transports, the sandbox, and the plugin store load only when
 * models are used.
 */

import type { PluginStore } from "../platform/plugin-store.ts";
import { IdbPluginStore } from "../platform/plugin-store.ts";
import { ModelHost } from "./host.ts";
import { installedClient } from "./installed-client.ts";
import {
  type DamagedPlugin,
  fetchPackage,
  type InstalledPlugin,
  type Inspection,
  inspect,
  install,
  loadInstalled,
  remove,
} from "./installed.ts";
import { MANIFEST, type PluginDefinition } from "./manifest.ts";
import { pluginIdOf, type PluginId } from "./plugin-id.ts";
import type { PluginRegistryApi } from "./registry-api.ts";
import {
  openSandbox,
  type SandboxOptions,
  type SandboxPort,
  sandboxSelfTest,
  weakPolicyForTesting,
} from "./sandbox.ts";

/** A host with every plugin in `manifest` registered. */
export function createHost(manifest: readonly PluginDefinition[] = MANIFEST): ModelHost {
  const host = new ModelHost();
  for (const plugin of manifest) host.register({ card: plugin.descriptor.card, connect: plugin.connect });
  return host;
}

export interface RegistryDeps {
  readonly manifest?: readonly PluginDefinition[];
  readonly store: PluginStore;
  readonly fetch: typeof fetch;
  readonly open: (options: SandboxOptions) => Promise<SandboxPort>;
  /** Whether this browser enforces the sandbox; asked once, before the first installed plugin starts. */
  readonly sandboxWorks: () => Promise<boolean>;
  readonly now?: () => Date;
}

/** The bundled plugins and the installed ones, on one host. */
export class PluginRegistry implements PluginRegistryApi {
  readonly host: ModelHost;
  readonly #deps: RegistryDeps;
  readonly #installed = new Map<string, InstalledPlugin>();
  #damaged: DamagedPlugin[] = [];
  #loaded: Promise<void> | null = null;

  constructor(deps: RegistryDeps) {
    this.#deps = deps;
    this.host = createHost(deps.manifest);
  }

  /** Load and register the installed plugins, once; bundled plugins are already registered. */
  load(): Promise<void> {
    this.#loaded ??= (async () => {
      const { installed, damaged } = await loadInstalled(this.#deps.store);
      for (const plugin of installed) this.#register(plugin);
      this.#damaged = damaged;
    })();
    return this.#loaded;
  }

  /** The installed plugins that passed their checks, by name. */
  installed(): InstalledPlugin[] {
    return [...this.#installed.values()].sort((a, b) => a.pkg.card.name.localeCompare(b.pkg.card.name));
  }

  /** The stored plugins that failed their checks and don't run. */
  damaged(): readonly DamagedPlugin[] {
    return this.#damaged;
  }

  /** Whether this browser can run installed plugins at all. */
  sandboxWorks(): Promise<boolean> {
    return this.#deps.sandboxWorks();
  }

  /** Check a package the author chose, and say what installing it would do. Stores nothing. */
  async inspect(bytes: Uint8Array, sourceUrl = ""): Promise<Inspection> {
    await this.load();
    return inspect(this.#deps.store, bytes, sourceUrl);
  }

  /** Fetch a package from an HTTPS URL the author gave, and inspect it. */
  async inspectUrl(url: string, signal?: AbortSignal): Promise<Inspection> {
    const bytes = await fetchPackage(this.#deps.fetch, url, signal);
    return this.inspect(bytes, new URL(url).href);
  }

  /** Fetch an installed plugin's URL again, and inspect what's there; only when the author asks. */
  async checkForUpdate(id: string, signal?: AbortSignal): Promise<Inspection> {
    const plugin = this.#installed.get(id);
    if (!plugin?.sourceUrl) throw new Error("This plugin wasn’t installed from a URL.");
    return this.inspectUrl(plugin.sourceUrl, signal);
  }

  /** Install an inspected package, replacing the version it updates. */
  async install(inspection: Inspection): Promise<InstalledPlugin> {
    await this.load();
    const plugin = await install(this.#deps.store, inspection, (this.#deps.now ?? (() => new Date()))());
    this.host.unregister(pluginIdOf(plugin.pkg.card));
    this.#register(plugin);
    this.#damaged = this.#damaged.filter((d) => d.id !== plugin.id);
    return plugin;
  }

  /** Remove an installed or damaged plugin: its code, files, pinned key, and source URL. */
  async remove(id: string): Promise<void> {
    await this.load();
    await remove(this.#deps.store, id);
    const plugin = this.#installed.get(id);
    if (plugin) this.host.unregister(pluginIdOf(plugin.pkg.card));
    this.#installed.delete(id);
    this.#damaged = this.#damaged.filter((d) => d.id !== id);
  }

  #register(plugin: InstalledPlugin): PluginId {
    const { pkg } = plugin;
    const deps = this.#deps;
    const id = this.host.register({
      card: pkg.card,
      connect: async (context) =>
        installedClient({
          pkg,
          files: deps.store,
          context,
          fetch: deps.fetch,
          open: deps.open,
          sandboxWorks: deps.sandboxWorks,
        }),
    });
    this.#installed.set(plugin.id, plugin);
    return id;
  }
}

/** In development, `?sandbox-selftest-fail` makes the self-test see a browser that doesn't enforce the sandbox. */
function forceSelfTestFailure(): boolean {
  return (
    Boolean(import.meta.env?.DEV) &&
    typeof location !== "undefined" &&
    location.search.includes("sandbox-selftest-fail")
  );
}

let selfTest: Promise<boolean> | null = null;

/** The self-test, once per tab. */
function sandboxWorks(): Promise<boolean> {
  selfTest ??= (async () =>
    sandboxSelfTest(forceSelfTestFailure() ? { policyOverride: await weakPolicyForTesting() } : {}))();
  return selfTest;
}

let registry: PluginRegistry | null = null;

/** The app's one registry: the bundled plugins, and the installed ones from this browser's store. */
export function pluginRegistry(): PluginRegistry {
  registry ??= new PluginRegistry({
    store: new IdbPluginStore(),
    fetch: (input, init) => globalThis.fetch(input, init),
    open: openSandbox,
    sandboxWorks,
  });
  return registry;
}
