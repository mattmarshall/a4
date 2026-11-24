import { test } from "node:test";
import assert from "node:assert/strict";
import { PRESETS } from "../../page/index.ts";
import { FLAT } from "../paper/deform.ts";
import { changes, INITIAL_STATE, isPoseAttribute, orbit, reduce, type SheetAction } from "./state.ts";

const attr = (name: Extract<SheetAction, { type: "attribute" }>["name"], value: string | null): SheetAction => ({
  type: "attribute",
  name,
  value,
});

test("the initial state is the attribute table's defaults", () => {
  assert.equal(INITIAL_STATE.spec, PRESETS.terminal);
  assert.equal(INITIAL_STATE.lens, "ink");
  assert.equal(INITIAL_STATE.plane, null);
  assert.equal(INITIAL_STATE.request, "auto");
  assert.deepEqual(INITIAL_STATE.pose, FLAT);
  assert.deepEqual(INITIAL_STATE.view, { tilt: 32, turn: 0, light: 215 });
  assert.equal(INITIAL_STATE.zoom, null);
  assert.equal(INITIAL_STATE.grid, false);
});

test("attributes parse through the table, and bad values fall back", () => {
  let s = reduce(INITIAL_STATE, attr("preset", "dense"));
  assert.equal(s.spec, PRESETS.dense);
  s = reduce(s, attr("preset", "nope"));
  assert.equal(s.spec, PRESETS.terminal);
  s = reduce(s, attr("tilt", "90"));
  assert.equal(s.view.tilt, 65);
  s = reduce(s, attr("light", "400"));
  assert.equal(s.view.light, 40);
  s = reduce(s, attr("zoom", "fit"));
  assert.equal(s.zoom, null);
  s = reduce(s, attr("grid", ""));
  assert.equal(s.grid, true);
  s = reduce(s, attr("render", "flat"));
  assert.equal(s.request, "flat");
  s = reduce(s, attr("label", "Brief"));
  assert.equal(s.label, "Brief");
});

test("the lens attribute splits into a built-in lens and a plane", () => {
  let s = reduce(INITIAL_STATE, attr("lens", "syntax"));
  assert.deepEqual([s.lens, s.plane], ["syntax", null]);
  s = reduce(s, attr("lens", "model:semantic"));
  assert.deepEqual([s.lens, s.plane], ["ink", "semantic"]);
});

test("the value attribute leaves the display state alone", () => {
  assert.equal(reduce(INITIAL_STATE, attr("value", "hello")), INITIAL_STATE);
});

test("pose attributes patch one part of the pose", () => {
  let s = reduce(INITIAL_STATE, attr("fold-bottom", "0.4"));
  s = reduce(s, attr("fold-top", "0.2"));
  assert.deepEqual(s.pose, { foldBottom: 0.4, foldTop: 0.2, curl: 0 });
  s = reduce(s, attr("fold-bottom", null));
  assert.deepEqual(s.pose, { foldBottom: 0, foldTop: 0.2, curl: 0 });
  assert.ok(isPoseAttribute("curl"));
  assert.ok(!isPoseAttribute("tilt"));
});

test("an attribute equal to the previous one still resets the live value", () => {
  // tilt="32" is set, the user orbits to 50, then script sets tilt="32" again.
  let s = reduce(INITIAL_STATE, attr("tilt", "32"));
  s = reduce(s, { type: "orbit", view: { tilt: 50, turn: 10 } });
  assert.deepEqual([s.view.tilt, s.view.turn], [50, 10]);
  s = reduce(s, attr("tilt", "32"));
  assert.equal(s.view.tilt, 32);
  assert.equal(s.view.turn, 10, "only the attribute that was set applies");
});

test("a pose action replaces the pose with a copy", () => {
  const pose = { foldBottom: 1, foldTop: 0.5, curl: 0 };
  const s = reduce(INITIAL_STATE, { type: "pose", pose });
  assert.deepEqual(s.pose, pose);
  assert.notEqual(s.pose, pose);
});

test("orbiting wraps the turn and clamps the tilt", () => {
  assert.deepEqual(orbit({ tilt: 32, turn: 0 }, 100, 40), { tilt: 42, turn: 30 });
  assert.deepEqual(orbit({ tilt: 60, turn: 170 }, 100, 100), { tilt: 65, turn: -160 });
  assert.deepEqual(orbit({ tilt: 5, turn: -170 }, -100, -100), { tilt: 0, turn: 160 });
});

test("changes name what a view has to redo", () => {
  const none = { content: false, view: false, pose: false, render: false, label: false };
  assert.deepEqual(changes(INITIAL_STATE, INITIAL_STATE), none);
  assert.deepEqual(changes(INITIAL_STATE, reduce(INITIAL_STATE, attr("tilt", "40"))), { ...none, view: true });
  assert.deepEqual(changes(INITIAL_STATE, reduce(INITIAL_STATE, attr("zoom", "3"))), { ...none, view: true });
  assert.deepEqual(changes(INITIAL_STATE, reduce(INITIAL_STATE, attr("curl", "0.5"))), { ...none, pose: true });
  assert.deepEqual(changes(INITIAL_STATE, reduce(INITIAL_STATE, attr("lens", "syntax"))), { ...none, content: true });
  assert.deepEqual(changes(INITIAL_STATE, reduce(INITIAL_STATE, attr("grid", ""))), { ...none, content: true });
  assert.deepEqual(changes(INITIAL_STATE, reduce(INITIAL_STATE, attr("render", "flat"))), { ...none, render: true });
  // The same value again is no change for the views.
  const tilted = reduce(INITIAL_STATE, attr("tilt", "40"));
  assert.deepEqual(changes(tilted, reduce(tilted, attr("tilt", "40"))), none);
});
