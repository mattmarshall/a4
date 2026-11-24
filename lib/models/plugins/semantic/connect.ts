/**
 * Start the Semantic repetition worker and connect to it. Loaded only through
 * the manifest's `connect`, on first use; the UI never imports it.
 */

import type { SheetModelClient } from "../../client.ts";
import { connectPort, fromWorker } from "../../worker-transport.ts";

export async function connect(): Promise<SheetModelClient> {
  const worker = new Worker(new URL("./worker.ts", import.meta.url), {
    type: "module",
    name: "a4-semantic-repetition",
  });
  return connectPort(fromWorker(worker));
}
