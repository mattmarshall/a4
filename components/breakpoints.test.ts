import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BREAKPOINTS, mediaQuery, resolveBreakpoints } from "./breakpoints.ts";

const ROOT = new URL("../", import.meta.url).pathname;

test("each breakpoint's media query covers windows up to its width", () => {
  assert.equal(mediaQuery("medium"), "(width <= 1359px)");
  assert.equal(mediaQuery("narrow"), "(width <= 1099px)");
  assert.ok(BREAKPOINTS.small < BREAKPOINTS.narrow && BREAKPOINTS.narrow < BREAKPOINTS.medium);
});

test("CSS names a breakpoint as custom media, and the build writes its query", () => {
  assert.equal(
    resolveBreakpoints("@media (--bp-narrow) { .x { color: red; } }"),
    "@media (width <= 1099px) { .x { color: red; } }",
  );
  assert.throws(() => resolveBreakpoints("@media (--bp-huge) {}"), /Unknown breakpoint --bp-huge/);
});

test("stylesheets write no window widths of their own", () => {
  const sheets = ["app", "components"].flatMap((dir) =>
    readdirSync(join(ROOT, dir), { recursive: true, encoding: "utf8" })
      .filter((f) => f.endsWith(".css"))
      .map((f) => join(dir, f)),
  );
  assert.ok(sheets.includes("app/globals.css"));
  const raw = sheets.flatMap((file) =>
    [...readFileSync(join(ROOT, file), "utf8").matchAll(/@media[^{]*\b(?:max-|min-)?width\b[^{]*\{/g)].map(
      (m) => `${file}: ${m[0]}`,
    ),
  );
  assert.deepEqual(raw, [], "use @media (--bp-<name>) from components/breakpoints.ts");
});
