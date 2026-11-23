import assert from "node:assert/strict";
import { test } from "node:test";
import { PRESETS } from "../../page-spec.ts";
import { cellValue, MAX_PAIRS, scoreUnits } from "./similarity.ts";
import { extractUnits, type Unit } from "./units.ts";

const T = PRESETS.terminal;

// --- Units of meaning -------------------------------------------------------

test("units: sentences across wrapped lines", () => {
  const text = [
    "The deploy failed at noon because the signing",
    "token expired overnight. We rotated the token and",
    "redeployed the service right away.",
  ].join("\n");
  const units = extractUnits(text);
  assert.equal(units.length, 2);
  assert.equal(text.slice(units[0].start, units[0].end), "The deploy failed at noon because the signing\ntoken expired overnight.");
  assert.equal(units[0].text, "The deploy failed at noon because the signing token expired overnight.");
  assert.equal(text.slice(units[1].start, units[1].end), "We rotated the token and\nredeployed the service right away.");
  assert.ok(units.every((u) => u.kind === "prose"));
});

test("units: short fields are skipped, longer fields and headings are units", () => {
  const text = "id: 7\nowner: platform-team\n\n# INCIDENT SUMMARY";
  const units = extractUnits(text);
  assert.deepEqual(
    units.map((u) => [u.kind, u.text]),
    [
      ["structured", "owner: platform-team"],
      ["heading", "# INCIDENT SUMMARY"],
    ],
  );
});

test("units: each list item starts its own paragraph, marker excluded from the span", () => {
  const text = "1. Write the context you plan to hand the agent\n2. Watch the margin gauge for crowded rows";
  const units = extractUnits(text);
  assert.equal(units.length, 2);
  assert.equal(text.slice(units[0].start, units[0].end), "Write the context you plan to hand the agent");
  assert.equal(text.slice(units[1].start, units[1].end), "Watch the margin gauge for crowded rows");
});

// --- Similarity and the plane ----------------------------------------------

/** Unit vectors from angles, so cosine similarity is cos(θa − θb). */
const unitVec = (theta: number) => Float32Array.from([Math.cos(theta), Math.sin(theta)]);
const withSimilarity = (s: number) => [unitVec(0), unitVec(Math.acos(s))];

function twoUnits(): { text: string; units: Unit[] } {
  const text = "First sentence goes here.\nSecond sentence goes here.";
  return { text, units: extractUnits(text) };
}

test("model lens values: below the floor every cell holds 0", () => {
  const { text, units } = twoUnits();
  const score = scoreUnits(text, units, withSimilarity(0.62), T);
  assert.equal(score.values.length, 60 * 80);
  assert.ok(score.values.every((v) => v === 0));
  assert.equal(score.restating, 0);
});

test("model lens values: a 0.91 match fills each unit's cells with 0.7", () => {
  const { text, units } = twoUnits();
  const score = scoreUnits(text, units, withSimilarity(0.91), T);
  assert.ok(Math.abs(cellValue(0.91) - 0.7) < 1e-9);
  // Row 0 holds unit 0 ("First sentence goes here."), row 1 holds unit 1.
  for (const [row, unit] of [[0, units[0]], [1, units[1]]] as const) {
    const len = unit.end - unit.start;
    for (let c = 0; c < len; c++) assert.ok(Math.abs(score.values[row * 80 + c] - 0.7) < 1e-5);
    assert.equal(score.values[row * 80 + len], 0);
  }
  assert.equal(score.restating, 2);
  assert.equal(score.pairs.length, 1);
  assert.equal(score.pairs[0].b, 1, "the later unit is b");
});

test("similarity: identical units don't count as restating", () => {
  const text = "Restart the worker pool now.\nRestart the worker pool now.";
  const units = extractUnits(text);
  const score = scoreUnits(text, units, [unitVec(0), unitVec(0)], T);
  assert.equal(score.restating, 0);
  assert.ok(score.values.every((v) => v === 0));
});

test("summary: at most 5 pairs, most similar first", () => {
  const text = Array.from({ length: 8 }, (_, i) => `Sentence number ${i} says the same thing.`).join("\n");
  const units = extractUnits(text);
  assert.equal(units.length, 8);
  const vectors = units.map((_, i) => unitVec(i * 0.01)); // all pairwise ≥ 0.997
  const score = scoreUnits(text, units, vectors, T);
  assert.equal(score.pairs.length, MAX_PAIRS);
  for (let k = 1; k < score.pairs.length; k++) assert.ok(score.pairs[k - 1].similarity >= score.pairs[k].similarity);
  assert.equal(score.restating, 8);
});
