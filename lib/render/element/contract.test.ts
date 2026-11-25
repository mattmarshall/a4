import { test } from "node:test";
import assert from "node:assert/strict";
import { ATTRIBUTES, modelLens, OBSERVED_ATTRIBUTES, parseLensAttr, toAttributes } from "./contract.ts";

test("the element observes every attribute in the table, once", () => {
  assert.deepEqual(OBSERVED_ATTRIBUTES, [
    "value",
    "preset",
    "lens",
    "render",
    "fold-bottom",
    "fold-top",
    "curl",
    "tilt",
    "turn",
    "light",
    "zoom",
    "grid",
    "label",
    "readonly",
  ]);
});

test("readonly is a boolean attribute that serializes as present or absent", () => {
  assert.equal(ATTRIBUTES.readOnly.parse(""), true);
  assert.equal(ATTRIBUTES.readOnly.parse("readonly"), true);
  assert.equal(ATTRIBUTES.readOnly.parse("false"), false);
  assert.equal(ATTRIBUTES.readOnly.parse(null), false);
  const attrs = toAttributes({ readOnly: true });
  assert.equal(attrs.get("readonly"), "");
  assert.equal(toAttributes({ readOnly: false }).get("readonly"), null);
});

test("numbers clamp to their range, and bad values fall back to the default", () => {
  assert.equal(ATTRIBUTES.tilt.parse("90"), 65);
  assert.equal(ATTRIBUTES.tilt.parse("-5"), 0);
  assert.equal(ATTRIBUTES.tilt.parse("soon"), 32);
  assert.equal(ATTRIBUTES.tilt.parse(null), 32);
  assert.equal(ATTRIBUTES.turn.parse("-200"), -180);
  assert.equal(ATTRIBUTES.curl.parse("0.45"), 0.45);
});

test("light wraps around the compass", () => {
  assert.equal(ATTRIBUTES.light.parse("215"), 215);
  assert.equal(ATTRIBUTES.light.parse("400"), 40);
  assert.equal(ATTRIBUTES.light.parse("-90"), 270);
  assert.equal(ATTRIBUTES.light.parse(null), 215);
});

test("choices, zoom, and grid parse as the element always did", () => {
  assert.equal(ATTRIBUTES.preset.parse("elite"), "elite");
  assert.equal(ATTRIBUTES.preset.parse("toString"), "terminal");
  assert.equal(ATTRIBUTES.render.parse("3d"), "3d");
  assert.equal(ATTRIBUTES.render.parse("webgl"), "auto");
  assert.equal(ATTRIBUTES.zoom.parse("fit"), null);
  assert.equal(ATTRIBUTES.zoom.parse(null), null);
  assert.equal(ATTRIBUTES.zoom.parse("40"), 12);
  assert.equal(ATTRIBUTES.grid.parse(""), true);
  assert.equal(ATTRIBUTES.grid.parse("false"), false);
  assert.equal(ATTRIBUTES.grid.parse(null), false);
});

test("a lens is built in, or a model lens naming a plane", () => {
  assert.deepEqual(parseLensAttr("syntax"), { lens: "syntax", plane: null });
  assert.deepEqual(parseLensAttr(modelLens("semantic/similarity")), { lens: "ink", plane: "semantic/similarity" });
  assert.deepEqual(parseLensAttr("model:"), { lens: "ink", plane: null });
  assert.deepEqual(parseLensAttr("sparkle"), { lens: "ink", plane: null });
  assert.equal(ATTRIBUTES.lens.parse("model:x"), "model:x");
});

test("the wrapper's attributes come from the table", () => {
  const attrs = toAttributes({ tilt: 40, zoom: null, grid: false, lens: modelLens("p"), foldBottom: 0.4 });
  assert.deepEqual(Object.fromEntries(attrs), {
    lens: "model:p",
    "fold-bottom": "0.4",
    tilt: "40",
    zoom: "fit",
    grid: null,
  });
  // Every serialized value parses back to itself.
  assert.equal(ATTRIBUTES.tilt.parse(attrs.get("tilt") ?? null), 40);
  assert.equal(ATTRIBUTES.zoom.parse(attrs.get("zoom") ?? null), null);
  assert.equal(ATTRIBUTES.grid.parse(attrs.get("grid") ?? null), false);
});
