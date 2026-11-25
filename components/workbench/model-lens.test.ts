import { test } from "node:test";
import assert from "node:assert/strict";
import { SEMANTIC_REPETITION } from "../../lib/models/index.ts";
import { overlayCard, penCard } from "../../lib/models/testing/packages.ts";
import { legendOf, lensSources, planeKey, rescoresWhileTyping } from "./model-lens.ts";

test("an installed overlay's plane has a key naming its plugin and plane", () => {
  const [source] = lensSources([{ card: overlayCard(), publisher: "Unknown publisher (calls itself “Example Labs”)" }]);
  assert.ok(source);
  assert.equal(planeKey(source.pluginId, source.plane), "example.word-length/Word length");
  assert.notEqual(
    planeKey(source.pluginId, source.plane),
    planeKey(SEMANTIC_REPETITION.id, source.plane),
    "two plugins' planes with one name never collide",
  );
});

test("an on-device overlay rescores while typing; a remote one doesn't", () => {
  assert.equal(rescoresWhileTyping(overlayCard()), true);
  assert.equal(
    rescoresWhileTyping(overlayCard({ placement: { case: "remote", value: { destinationHost: "api.example.com" } } })),
    false,
  );
  assert.equal(rescoresWhileTyping(SEMANTIC_REPETITION.card), true);
});

test("only scoring cards give lenses, one per plane", () => {
  const sources = lensSources([
    { card: SEMANTIC_REPETITION.card, publisher: null },
    { card: penCard(), publisher: "X" },
    { card: overlayCard(), publisher: "Y" },
  ]);
  assert.deepEqual(
    sources.map((s) => `${s.pluginId}/${s.plane}`),
    [`${SEMANTIC_REPETITION.id}/${SEMANTIC_REPETITION.names.plane}`, "example.word-length/Word length"],
  );
});

test("an installed plane's legend names the plane, the plugin, and the publisher", () => {
  const [source] = lensSources([{ card: overlayCard(), publisher: "Unknown publisher (calls itself “Example Labs”)" }]);
  assert.ok(source);
  const legend = legendOf(source);
  assert.equal(legend?.plane, "Word length");
  assert.equal(legend?.plugin, "Word length");
  assert.equal(legend?.publisher, "Unknown publisher (calls itself “Example Labs”)");
});

test("Semantic repetition's legend keeps its scale and marks, with no publisher", () => {
  const [source] = lensSources([{ card: SEMANTIC_REPETITION.card, publisher: null }]);
  assert.ok(source);
  const legend = legendOf(source);
  assert.match(legend?.scale ?? "", /0\.60 → 1\.00$/);
  assert.match(legend?.note ?? "", /0\.85 or more/);
  assert.equal(legend?.publisher, undefined);
});
