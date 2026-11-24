/** Worker entry for Semantic repetition: serve the plugin on the worker's own port, so the model never blocks the editor. */

import { servePort, type PortLike } from "../../worker-transport.ts";
import { semanticModelCached } from "./cache.ts";
import { loadPinnedLibrary } from "./library.ts";
import { createSemanticPlugin } from "./plugin.ts";

servePort(
  self as unknown as PortLike,
  createSemanticPlugin({ importLibrary: loadPinnedLibrary, isCached: semanticModelCached }),
);
