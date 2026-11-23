/**
 * The bundled plugins. Only these run: the host never loads plugin code from
 * page content, imports, or URLs. Cards are static, and each plugin's code
 * loads on first use.
 */

import { FIT_TO_PAGE_CARD } from "./fit/card.ts";
import { ModelHost, type PluginEntry } from "./host.ts";
import { SEMANTIC_REPETITION_CARD } from "./semantic/card.ts";
import { connectPort, type PortLike } from "./worker-transport.ts";

export function bundledPlugins(): PluginEntry[] {
  return [
    {
      card: SEMANTIC_REPETITION_CARD,
      connect: async () => {
        const worker = new Worker(new URL("./semantic/worker.ts", import.meta.url), {
          type: "module",
          name: "a4-semantic-repetition",
        });
        return connectPort(worker as unknown as PortLike);
      },
    },
    {
      card: FIT_TO_PAGE_CARD,
      // In-process: the SDK loads on first use, and calls need the tab's abort controls.
      connect: async () => (await import("./fit/adapter.ts")).fitToPagePlugin(),
    },
  ];
}

let host: ModelHost | null = null;

/** The app's one model host, with every bundled plugin registered. */
export function modelHost(): ModelHost {
  if (!host) {
    host = new ModelHost();
    for (const plugin of bundledPlugins()) host.register(plugin);
  }
  return host;
}
