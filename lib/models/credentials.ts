/**
 * Credentials the author enters for a plugin (an API key), held by the host in
 * memory for the tab's lifetime only. They are never written to storage, page
 * files, exports, the journal, or logs, and a reload forgets them. Each is
 * keyed by plugin and the credential kind the plugin's card declares, and a
 * plugin receives only a getter for its own.
 */

import type { PluginId } from "./plugin-id.ts";

export class CredentialStore {
  readonly #values = new Map<string, string>();

  #key(id: PluginId, kind: string): string {
    return `${id}\u0000${kind}`;
  }

  /** Keep `value` (trimmed); an empty value forgets the credential. */
  set(id: PluginId, kind: string, value: string): void {
    const trimmed = value.trim();
    if (trimmed) this.#values.set(this.#key(id, kind), trimmed);
    else this.forget(id, kind);
  }

  get(id: PluginId, kind: string): string | null {
    return this.#values.get(this.#key(id, kind)) ?? null;
  }

  has(id: PluginId, kind: string): boolean {
    return this.#values.has(this.#key(id, kind));
  }

  forget(id: PluginId, kind: string): void {
    this.#values.delete(this.#key(id, kind));
  }
}
