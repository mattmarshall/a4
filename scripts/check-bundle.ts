/**
 * Fail when the home page's first load includes code that should load on
 * first use: plugin implementations, and the heavy model libraries (the
 * Anthropic SDK when Fit to page sends; transformers.js and ONNX Runtime in
 * the semantic worker).
 *
 * The first load is every script and module preload in the prerendered home
 * page, plus their static imports from the client build's Vite manifest. The
 * build records each client chunk's source modules (recordClientChunks in
 * vite.config.ts), so a module pulled in by a static import is found even
 * when bundling merges it into another chunk. Run after `pnpm build`.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const HOME_HTML = "dist/server/prerendered-routes/index.html";
const CHUNKS_REPORT = "dist/client-chunks.json";
const ASSETS = ".cloudflare/output/v1/workers/default/assets";
const MANIFEST = join(ASSETS, ".vite/manifest.json");

/** Modules that must stay out of the first load, by what they are. */
const LAZY: Record<string, RegExp> = {
  "the Fit to page adapter": /^lib\/models\/fit\/adapter\.ts$/,
  "the semantic worker": /^lib\/models\/semantic\/worker\.ts$/,
  "@anthropic-ai/sdk": /(^|\/)node_modules\/@anthropic-ai\/sdk\//,
  "@huggingface/transformers": /(^|\/)node_modules\/@huggingface\/transformers\//,
  "onnxruntime-web": /(^|\/)node_modules\/onnxruntime-(web|common)\//,
};

interface ManifestChunk {
  file: string;
  imports?: string[];
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

for (const path of [HOME_HTML, CHUNKS_REPORT, MANIFEST]) {
  if (!existsSync(path)) fail(`Missing ${path}. Run \`pnpm build\` first.`);
}

const manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as Record<string, ManifestChunk>;
const chunkModules = JSON.parse(readFileSync(CHUNKS_REPORT, "utf8")) as Record<string, string[]>;
const byFile = new Map(Object.values(manifest).map((chunk) => [chunk.file, chunk]));

/** Script and module-preload URLs in the page, as asset paths. */
function pageScripts(html: string): string[] {
  const out: string[] = [];
  for (const [tag] of html.matchAll(/<(?:script|link)\b[^>]*>/g)) {
    if (tag.startsWith("<link") && !/\brel="modulepreload"/.test(tag)) continue;
    const url = /\b(?:src|href)="([^"]+)"/.exec(tag)?.[1];
    if (url && /\.m?js$/.test(url) && url.startsWith("/")) out.push(url.slice(1));
  }
  return out;
}

const firstLoad = new Set<string>();
const queue = pageScripts(readFileSync(HOME_HTML, "utf8"));
for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
  if (firstLoad.has(file)) continue;
  firstLoad.add(file);
  for (const key of byFile.get(file)?.imports ?? []) {
    const imported = manifest[key];
    if (imported) queue.push(imported.file);
  }
}
if (firstLoad.size === 0) fail(`Found no scripts in ${HOME_HTML}; the bundle check can't see the first load.`);

const problems: string[] = [];
let bytes = 0;
for (const file of firstLoad) {
  const modules = chunkModules[file];
  if (!modules || !existsSync(join(ASSETS, file))) {
    problems.push(`${file} is loaded by the page but missing from the build report`);
    continue;
  }
  bytes += statSync(join(ASSETS, file)).size;
  for (const [what, pattern] of Object.entries(LAZY)) {
    const found = modules.find((id) => pattern.test(id));
    if (found) problems.push(`${file} contains ${what} (${found})`);
  }
}

if (problems.length) {
  fail(
    `The home page's first load includes code that should load on first use:\n  ${problems.join("\n  ")}\n` +
      "Reach plugins through lib/models/registry.ts, which imports them dynamically.",
  );
}
console.log(
  `First load: ${firstLoad.size} chunks, ${Math.round(bytes / 1024)} KiB, with no plugin or model library code.`,
);
