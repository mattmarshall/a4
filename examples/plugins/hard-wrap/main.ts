/** The Hard wrap plugin's entry: the script `pnpm build:examples` bundles and packs. */

import { servePlugin } from "../../../lib/models/kit/serve.ts";
import card from "./card.json" with { type: "json" };
import { handlers } from "./plugin.ts";

servePlugin(card, handlers);
