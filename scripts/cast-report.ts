/**
 * Brand casts: a branded id (a page name, file path, revision, trash id, or
 * plugin id) is minted only by its parser, so a cast like `x as PageName`
 * anywhere else fails this check. Double casts (`as unknown as`) are listed
 * too, and fail unless the file is in DOUBLE_CASTS with the reason it needs
 * one. Run by `pnpm lint`.
 *
 * The enclosing function of a cast is the nearest function or method
 * declared above it, which is exact for the small top-level parsers listed
 * here.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const BRANDS = ["PageName", "FilePath", "Revision", "TrashId", "PluginId"];

/** The functions allowed to cast to a brand: its parsers, and the test-only forgers. */
const PARSERS: Record<string, readonly string[]> = {
  "lib/persist/store/names.ts": ["parsePageName", "storedPageName"],
  "lib/persist/store/refs.ts": ["parseFilePath"],
  "lib/persist/store/revision.ts": ["revisionOf", "parseRevision"],
  "lib/persist/store/trash-ids.ts": ["parseTrashId", "makeTrashId"],
  "lib/models/plugin-id.ts": ["pluginIdOf"],
  "lib/persist/store/testing/forge.ts": ["forgePageName", "forgeFilePath"],
};

/** Files allowed `as unknown as`, and why the types can't line up without it. */
const DOUBLE_CASTS: Record<string, string> = {
  // Worker scope typing: the app compiles with the DOM lib, not the webworker
  // lib, so the worker's `self` and the transformers.js pipeline (typed for
  // Node and the browser at once) are cast to the narrow interfaces it uses.
  "lib/models/plugins/semantic/worker.ts": "worker scope typing",
  // The Anthropic SDK boundary: its client and message params are cast to the
  // small interfaces the adapter uses, so tests can stand in for the SDK.
  "lib/models/plugins/fit/adapter.ts": "SDK boundary",
  "lib/models/plugins/fit/fit.test.ts": "records the SDK request body as plain data",
  "lib/models/consent.test.ts": "forges a consent token on purpose, to show the host refuses it",
  "lib/persist/store/testing/fake-opfs.ts": "the fake implements only the File System Access methods the stores use",
};

const ROOTS = ["app", "components", "lib", "scripts", "types"];
const SKIP = new Set(["lib/gen", "node_modules", "scripts/cast-report.ts"]);

function* sourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (SKIP.has(path)) continue;
    if (entry.isDirectory()) yield* sourceFiles(path);
    else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts")) yield path;
  }
}

/** Blank out comments, keeping line breaks so line numbers stay right. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
    .replace(/(^|[^:"'`\\])\/\/.*$/gm, (_match, before: string) => before);
}

const DECLARATION = [
  // function parse(…)
  /\bfunction\s+(\w+)/,
  // A method: parse(value: string): Id | null {
  /^\s*(?:(?:public|private|protected|static|async|override|get|set)\s+)*#?(\w+)\s*(?:<[^>]*>)?\([^;]*\)\s*(?::[^;{]+)?\{\s*$/,
  // const parse = (value) => …
  /\b(?:const|let)\s+(\w+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|\w+)\s*(?::[^=]+)?=>/,
];

function braceBalance(text: string): number {
  let depth = 0;
  for (const ch of text) {
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
  }
  return depth;
}

/** The innermost function or method declared above line `index` whose body is still open there. */
function enclosingFunction(lines: string[], index: number): string | null {
  for (let i = index; i >= 0; i--) {
    for (const pattern of DECLARATION) {
      const name = pattern.exec(lines[i] ?? "")?.[1];
      if (!name || ["if", "for", "while", "switch", "catch", "return"].includes(name)) continue;
      const line = lines[index] ?? "";
      const opened = lines.slice(i, index).join("\n") + line.slice(0, line.search(brandCast) + 1);
      if (i === index || braceBalance(opened) > 0) return name;
    }
  }
  return null;
}

const brandCast = new RegExp(`\\bas\\s+(?:readonly\\s+)?(${BRANDS.join("|")})\\b`);
const doubleCast = /\bas\s+unknown\s+as\b/;

const brandProblems: string[] = [];
const doubles: string[] = [];
const doubleProblems: string[] = [];
let allowedBrandCasts = 0;

for (const root of ROOTS) {
  for (const path of sourceFiles(root)) {
    const file = relative(".", path);
    const lines = stripComments(readFileSync(path, "utf8")).split("\n");
    lines.forEach((line, i) => {
      const brand = brandCast.exec(line)?.[1];
      if (brand) {
        const fn = enclosingFunction(lines, i);
        if (fn && PARSERS[file]?.includes(fn)) allowedBrandCasts++;
        else brandProblems.push(`${file}:${i + 1} casts to ${brand} in ${fn ?? "top-level code"}`);
      }
      if (doubleCast.test(line)) {
        doubles.push(`${file}:${i + 1}`);
        if (!DOUBLE_CASTS[file]) doubleProblems.push(`${file}:${i + 1}`);
      }
    });
  }
}

console.log(`Brand casts: ${allowedBrandCasts} in parsers, ${brandProblems.length} elsewhere.`);
console.log(`Double casts (as unknown as): ${doubles.length}, ${doubleProblems.length} not documented.`);
if (brandProblems.length || doubleProblems.length) {
  if (brandProblems.length) {
    console.error(`\nMint branded ids with their parsers, not a cast:\n  ${brandProblems.join("\n  ")}`);
  }
  if (doubleProblems.length) {
    console.error(
      `\nType these without \`as unknown as\`, or list the file in DOUBLE_CASTS with why it needs one:\n  ${doubleProblems.join("\n  ")}`,
    );
  }
  process.exitCode = 1;
}
