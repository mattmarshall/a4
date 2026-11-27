/**
 * The app's model host, built from the manifest (lib/models/manifest.ts),
 * with the author's installed plugins registered beside the bundled ones
 * (README, "Third-party plugins"). The UI imports this module dynamically, so
 * the host, its transports, the sandbox, and the plugin store load only when
 * models are used.
 *
 * Every tab keeps its own registry. After an install, update, or removal, a
 * tab posts an `a4.v1.PluginEvent` on PLUGIN_CHANNEL, and the other tabs read
 * that plugin's record again (design: harden-pens-and-plugins, decision 5).
 */

import { sameBytes } from "../platform/bytes.ts";
import { browserChannel, type Channel } from "../platform/channel.ts";
import { IdbPluginStore, PLUGIN_CHANNEL, type PluginStore } from "../platform/plugin-store.ts";
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
  loadOne,
  remove,
} from "./installed.ts";
import { MANIFEST, type PluginDefinition } from "./manifest.ts";
import type { PluginId } from "./plugin-id.ts";
import { changedPluginId, encodePluginEvent, pluginChanged } from "./plugin-events.ts";
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
  /** Where this tab tells other tabs about installs, updates, and removals, and hears theirs; null for nowhere. */
  readonly channel: Channel | null;
  readonly now?: () => Date;
}

/** The bundled plugins and the installed ones, on one host. */
export class PluginRegistry implements PluginRegistryApi {
  readonly host: ModelHost;
  readonly #deps: RegistryDeps;
  readonly #installed = new Map<PluginId, InstalledPlugin>();
  #damaged: DamagedPlugin[] = [];
  #loaded: Promise<void> | null = null;
  readonly #listeners = new Set<() => void>();
  /** Changes to the installed plugins, this tab's and those heard from others, applied one at a time. */
  #queue: Promise<unknown> = Promise.resolve();

  constructor(deps: RegistryDeps) {
    this.#deps = deps;
    this.host = createHost(deps.manifest);
  }

  /**
   * Load and register the installed plugins, once; bundled plugins are already
   * registered. From then on, this registry hears other tabs' changes. The
   * load runs first in the queue of changes, so a change heard while it reads
   * the store is applied after it, to what it registered.
   */
  load(): Promise<void> {
    if (!this.#loaded) {
      this.#deps.channel?.subscribe((data) => this.#hear(data));
      this.#loaded = this.#serially(async () => {
        const { installed, damaged } = await loadInstalled(this.#deps.store);
        for (const plugin of installed) this.#register(plugin);
        this.#damaged = damaged;
      });
    }
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

  /**
   * Call `listener` after the installed or damaged plugins change: after this
   * tab's own install or removal, and after another tab's is heard. Returns
   * the unsubscribe.
   */
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
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
  async checkForUpdate(id: PluginId, signal?: AbortSignal): Promise<Inspection> {
    const plugin = this.#installed.get(id);
    if (!plugin?.sourceUrl) throw new Error("This plugin wasn’t installed from a URL.");
    return this.inspectUrl(plugin.sourceUrl, signal);
  }

  /** Install an inspected package, replacing the version it updates. */
  async install(inspection: Inspection): Promise<InstalledPlugin> {
    await this.load();
    return this.#serially(async () => {
      const plugin = await install(this.#deps.store, inspection, (this.#deps.now ?? (() => new Date()))());
      this.#post(plugin.id);
      this.#forget(plugin.id);
      this.#register(plugin);
      this.#notify();
      return plugin;
    });
  }

  /** Remove an installed plugin: its code, files, pinned key, and source URL. */
  remove(id: PluginId): Promise<void> {
    return this.#removeStored(id);
  }

  /** Remove a damaged plugin, by the id it's stored under. */
  removeDamaged(id: string): Promise<void> {
    return this.#removeStored(id);
  }

  /** Delete the record stored under `id` and what only it lists, then tell this tab and the others. */
  async #removeStored(id: string): Promise<void> {
    await this.load();
    await this.#serially(async () => {
      await remove(this.#deps.store, id);
      this.#post(id);
      this.#forget(id);
      this.#notify();
    });
  }

  /** Run `change` after every change before it, so changes to one plugin apply in order. */
  #serially<T>(change: () => Promise<T>): Promise<T> {
    const run = this.#queue.then(change);
    this.#queue = run.catch(() => {});
    return run;
  }

  /** Tell other tabs that `id` changed; called after the store write finishes. */
  #post(id: string): void {
    this.#deps.channel?.post(encodePluginEvent(pluginChanged(id)));
  }

  #notify(): void {
    for (const listener of [...this.#listeners]) listener();
  }

  /** Another tab's message: read the plugin it names again. Anything else is ignored. */
  #hear(data: unknown): void {
    const id = changedPluginId(data);
    if (id === null) return;
    void this.#serially(() => this.#reconcile(id)).catch(() => {});
  }

  /**
   * Bring this tab's registry in line with the record stored under `id`: gone,
   * damaged, or installed. A plugin whose package bytes didn't change is left
   * running; any other is unregistered (closing its client and forgetting its
   * credentials and consent) and registered again, as this tab's own update
   * does.
   */
  async #reconcile(id: string): Promise<void> {
    const loaded = await loadOne(this.#deps.store, id);
    const current = this.#find(id);
    if (loaded.is === "installed" && current && sameBytes(current.pkg.bytes, loaded.plugin.pkg.bytes)) return;
    this.#forget(id);
    if (loaded.is === "installed") this.#register(loaded.plugin);
    else if (loaded.is === "damaged") this.#damaged = [...this.#damaged, loaded.damaged];
    this.#notify();
  }

  /** The installed plugin stored under `id`, if it's registered. */
  #find(id: string): InstalledPlugin | undefined {
    for (const plugin of this.#installed.values()) if (plugin.id === id) return plugin;
    return undefined;
  }

  /** Unregister the plugin stored under `id`, if it's registered, and drop it from the installed and damaged lists. */
  #forget(id: string): void {
    const plugin = this.#find(id);
    if (plugin) {
      this.host.unregister(plugin.id);
      this.#installed.delete(plugin.id);
    }
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
    channel: browserChannel(PLUGIN_CHANNEL),
  });
  return registry;
}
