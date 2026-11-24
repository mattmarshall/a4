/**
 * A stylelint rule: every `var(--name)` without a fallback names a token the
 * app defines: in app/globals.css, in the sheet palette (the `--a4-*`
 * properties the build writes from lib/render/palette.ts), or in the file
 * itself. Stylelint's no-unknown-custom-properties looks only inside one
 * file, so it can't see either.
 */

import { readFileSync } from "node:fs";
import stylelint from "stylelint";
import { paletteCustomProperties } from "../lib/render/palette.ts";

const ruleName = "a4/known-tokens";
const messages = stylelint.utils.ruleMessages(ruleName, {
  unknown: (name: string) => `"${name}" isn't a token in app/globals.css, the palette, or this file.`,
});

const DEFINITION = /(--[\w-]+)\s*:/g;
const USE = /var\(\s*(--[\w-]+)\s*(,)?/g;

let globals: Set<string> | null = null;

/** Custom properties app/globals.css and the palette define. */
function globalTokens(): Set<string> {
  if (!globals) {
    const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
    globals = new Set([...css.matchAll(DEFINITION)].map((m) => m[1] ?? ""));
    for (const [name] of paletteCustomProperties()) globals.add(name);
  }
  return globals;
}

const rule: stylelint.Rule = (enabled: unknown) => (root, result) => {
  if (!enabled) return;
  const known = new Set(globalTokens());
  root.walkDecls((decl) => {
    if (decl.prop.startsWith("--")) known.add(decl.prop);
  });
  root.walkDecls((decl) => {
    for (const m of decl.value.matchAll(USE)) {
      const name = m[1] ?? "";
      if (m[2] || known.has(name)) continue;
      stylelint.utils.report({ ruleName, result, node: decl, message: messages.unknown(name), word: name });
    }
  });
};

rule.ruleName = ruleName;
rule.messages = messages;

export default stylelint.createPlugin(ruleName, rule);
