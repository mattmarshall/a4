/**
 * One real Fit to page run against Claude, through the same host and adapter
 * the app uses (the SDK's request, the fit check, and the repair loop). It
 * doesn't cover the browser itself (CORS, the consent dialog).
 *
 *   node --env-file=.env.local scripts/fit-smoke.ts [out.md] [--rows N]
 *
 * --rows N shrinks the page to N rows, to force the repair loop.
 *
 * Reads ANTHROPIC_API_KEY from the environment and never prints it. Sends the
 * worked incident sample (JSON, 116 rows) and costs a few cents.
 */

import { writeFileSync } from "node:fs";
import { FIT_TO_PAGE_CARD, FIT_TO_PAGE_ID } from "../lib/models/fit/card.ts";
import { fitToPagePlugin } from "../lib/models/fit/adapter.ts";
import { setApiKey } from "../lib/models/fit/key.ts";
import { grantConsent } from "../lib/models/consent.ts";
import { ModelHost } from "../lib/models/host.ts";
import { PRESETS } from "../lib/page-spec.ts";
import { SAMPLE_PAIRS } from "../lib/samples.ts";
import { layoutRows } from "../lib/text.ts";

const key = process.env.ANTHROPIC_API_KEY;
if (!key) {
  console.error("Set ANTHROPIC_API_KEY (for example: node --env-file=.env.local scripts/fit-smoke.ts).");
  process.exit(1);
}
setApiKey(key);

const rowsArg = process.argv.indexOf("--rows");
const rows = rowsArg > 0 ? Number(process.argv[rowsArg + 1]) : PRESETS.terminal.rows;
const spec = { ...PRESETS.terminal, rows };
const source = SAMPLE_PAIRS[0].a;
const host = new ModelHost();
host.register({ card: FIT_TO_PAGE_CARD, connect: async () => fitToPagePlugin() });

console.log(
  `Source: "${SAMPLE_PAIRS[0].name}" sample A, ${source.length} characters, ${layoutRows(source, spec.cols).length} rows (page holds ${spec.rows}).`,
);
const started = Date.now();
let lastReported = 0;
const result = await host.transform(FIT_TO_PAGE_ID, source, spec, {
  instruction: "fit",
  // The author asked for this run; in the app, only the consent dialog mints this.
  consent: grantConsent(FIT_TO_PAGE_ID, source),
  onProgress: ({ attempt, characters }) => {
    if (characters - lastReported >= 500) {
      lastReported = characters;
      console.log(`  attempt ${attempt}: ${characters} characters written`);
    }
  },
  onAttempt: ({ attempt, rowsUsed, fits }) => {
    lastReported = 0;
    console.log(
      `  attempt ${attempt} laid out to ${rowsUsed} rows${fits ? " (fits)" : ", asking for a shorter version"}`,
    );
  },
});
const seconds = ((Date.now() - started) / 1000).toFixed(1);

console.log(
  `\nResult from ${result.model} in ${seconds}s: ${result.fits ? "fits" : `over by ${result.overBy} rows`}, ` +
    `${result.rowsUsed} of ${result.rowsAllowed} rows, ${result.text.length} characters, ${result.attempts} attempt(s).`,
);
const out = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : undefined;
if (out) {
  writeFileSync(out, result.text);
  console.log(`Wrote the rewrite to ${out}.`);
}
