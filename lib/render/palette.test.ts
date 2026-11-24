import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { PALETTE, paletteCustomProperties } from "./palette.ts";

const ROOT = new URL("../../", import.meta.url).pathname;

/** A color as [r, g, b, alpha], or null if `literal` isn't one. */
function parseColor(literal: string): [number, number, number, number] | null {
  const hex = /^#([0-9a-f]{3,8})$/i.exec(literal)?.[1];
  if (hex) {
    const full = hex.length <= 4 ? [...hex].map((c) => c + c).join("") : hex;
    if (full.length !== 6 && full.length !== 8) return null;
    const n = (i: number) => parseInt(full.slice(i, i + 2), 16);
    return [n(0), n(2), n(4), full.length === 8 ? Math.round((n(6) / 255) * 100) / 100 : 1];
  }
  const fn = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/i.exec(literal);
  if (fn) return [Number(fn[1]), Number(fn[2]), Number(fn[3]), fn[4] === undefined ? 1 : Number(fn[4])];
  return null;
}

const key = (c: readonly number[]) => c.join(",");

/** Every palette color, and the model violet's rgb at any opacity. */
function paletteColors(): { exact: Map<string, string>; rgb: Map<string, string> } {
  const exact = new Map<string, string>();
  for (const [name, value] of paletteCustomProperties()) {
    const color = parseColor(value);
    if (color) exact.set(key(color), name);
  }
  const rgb = new Map([[PALETTE.model.rgb.replace(/\s/g, ""), "--a4-model-rgb"]]);
  return { exact, rgb };
}

function sources(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { recursive: true, encoding: "utf8" })
    .filter((f) => /\.(css|ts|tsx)$/.test(f) && !/\.test\.ts$/.test(f))
    .map((f) => join(dir, f))
    .filter((f) => !f.startsWith("lib/gen/") && f !== "lib/render/palette.ts");
}

test("every palette color is a CSS custom property, named after its place in the palette", () => {
  const props = paletteCustomProperties();
  const names = props.map(([name]) => name);
  assert.equal(new Set(names).size, names.length, "names are unique");
  assert.ok(names.every((n) => /^--a4-[a-z0-9-]+$/.test(n)));
  const byName = new Map(props);
  assert.equal(byName.get("--a4-paper"), PALETTE.paper);
  assert.equal(byName.get("--a4-page-overflow-wash"), PALETTE.page.overflowWash);
  assert.equal(byName.get("--a4-lens-heat-1"), PALETTE.lens.heat[0]);
  assert.equal(byName.get("--a4-lens-heat-4"), PALETTE.lens.heat[3]);
  assert.equal(byName.get("--a4-model-rgb"), PALETTE.model.rgb);
  const leaves = (value: unknown): number =>
    value && typeof value === "object" ? Object.values(value).reduce((n: number, v) => n + leaves(v), 0) : 1;
  assert.equal(props.length, leaves(PALETTE), "one property per palette leaf");
});

test("the palette's colors are written only in palette.ts", () => {
  const { exact, rgb } = paletteColors();
  const found: string[] = [];
  for (const file of [...sources("app"), ...sources("components"), ...sources("lib")]) {
    const text = readFileSync(join(ROOT, file), "utf8");
    for (const m of text.matchAll(/#[0-9a-f]{3,8}\b|rgba?\([^()]*\)/gi)) {
      const color = parseColor(m[0]);
      if (!color) continue;
      const name = exact.get(key(color)) ?? rgb.get(color.slice(0, 3).join(","));
      if (name) found.push(`${relative(ROOT, join(ROOT, file))}: ${m[0]} (use ${name})`);
    }
  }
  assert.deepEqual(found, [], `palette colors copied outside lib/render/palette.ts:\n${found.join("\n")}`);
});

test("the color parser reads the forms the sources use", () => {
  assert.deepEqual(parseColor("#fdfcf8"), [253, 252, 248, 1]);
  assert.deepEqual(parseColor("#FFF"), [255, 255, 255, 1]);
  assert.deepEqual(parseColor("#c2410c1f"), [194, 65, 12, 0.12]);
  assert.deepEqual(parseColor("rgba(59, 130, 246, 0.28)"), [59, 130, 246, 0.28]);
  assert.deepEqual(parseColor("rgb(109 40 217 / 0.5)"), [109, 40, 217, 0.5]);
  assert.equal(parseColor("rgba(var(--a4-model-rgb), 0)"), null);
});
