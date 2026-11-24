/**
 * Fit to page runs in-process: the SDK loads on first use, and calls need the
 * tab's abort controls. The API key comes from the host's credential store,
 * through the getter the host passes in. Loaded only through the manifest's
 * `connect`; the UI never imports it.
 */

import type { SheetModelClient } from "../../client.ts";
import type { PluginContext } from "../../host.ts";
import { fitToPagePlugin } from "./adapter.ts";
import { FIT_TO_PAGE } from "./descriptor.ts";

export async function connect(context: PluginContext): Promise<SheetModelClient> {
  return fitToPagePlugin({ apiKey: () => context.credential(FIT_TO_PAGE.names.credentials.apiKey) });
}
