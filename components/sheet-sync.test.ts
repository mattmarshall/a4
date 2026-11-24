import { test } from "node:test";
import assert from "node:assert/strict";
import type { A4Plane } from "../lib/render/index.ts";
import { attributeWrites, diffPlanes } from "./sheet-sync.ts";

const plane = (text: string): A4Plane => ({ text, values: new Float32Array(4) });

test("planes: new and changed ones are set, unchanged ones left alone, missing ones removed", () => {
  const kept = plane("kept");
  const old = plane("old");
  const shown = new Map([
    ["kept", kept],
    ["changed", old],
    ["gone", plane("gone")],
  ]);
  const changed = plane("new");
  const added = plane("added");
  const diff = diffPlanes({ kept, changed, added }, shown);
  assert.deepEqual(
    diff.set.map(([name]) => name),
    ["changed", "added"],
  );
  assert.equal(diff.set[0]?.[1], changed);
  assert.deepEqual(diff.remove, ["gone"]);
});

test("planes: no planes wanted removes every shown one", () => {
  assert.deepEqual(diffPlanes(undefined, new Map([["a", plane("a")]])), { set: [], remove: ["a"] });
});

test("attributes: written when they differ from what was last written", () => {
  const first = new Map<string, string | null>([
    ["tilt", "32"],
    ["grid", null],
  ]);
  assert.deepEqual(attributeWrites(first, new Map()), [
    ["tilt", "32"],
    ["grid", null],
  ]);
  const written = new Map(first);
  assert.deepEqual(attributeWrites(first, written), [], "nothing changed, nothing to write");
});

test("attributes: a prop back at an earlier value is written again (a camera reset after an orbit)", () => {
  // The wrapper wrote tilt 32, then 50 (the parent followed an orbit), then the parent resets to 32.
  const written = new Map<string, string | null>([["tilt", "50"]]);
  assert.deepEqual(attributeWrites(new Map([["tilt", "32"]]), written), [["tilt", "32"]]);
});
