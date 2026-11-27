import assert from "node:assert/strict";
import { test } from "node:test";
import { pageSpec } from "../../lib/page/index.ts";
import type { SharedPageView } from "../../lib/share/index.ts";
import { libraryRef } from "../../lib/persist/index.ts";
import { parsePageName } from "../../lib/persist/store/names.ts";
import type { SlotSnapshot } from "../../lib/workspace/index.ts";
import { sharedSlots } from "./shared-slots.ts";
import { stageOf } from "./stage.ts";
import type { Layout } from "./useLayout";
import type { SharedView } from "./useSharedView";

/** One of the reader's library pages. */
function slot(label: string, text = ""): SlotSnapshot {
  const name = parsePageName(label);
  return { kind: "library", ref: libraryRef(name), name, label, text, status: "saved", readOnly: false };
}

const own = { a: slot("Notes", "mine"), b: slot("Brief.a5", "also mine") };

function layoutOf(mode: "single" | "compare", target: "a" | "b"): Layout {
  return { mode, compare: mode === "compare", target } as Layout;
}

function sharedOf(names: readonly string[]): SharedView {
  const spec = pageSpec("pica", "a6");
  const pages: SharedPageView[] = names.map((name) => ({
    name,
    spec,
    bytes: new TextEncoder().encode("shared"),
    text: "shared",
    postmark: null,
  }));
  const [a, b] = pages;
  if (!a) throw new Error("a share link has at least one page");
  return {
    pages,
    seals: pages.map(() => ({ kind: "none" })),
    slots: sharedSlots(a, b),
    specs: { a: spec, b: spec },
  };
}

test("the reader's own pages: their layout, sizes from their names, and editable", () => {
  const stage = stageOf(own, layoutOf("compare", "b"), "terminal", null);
  assert.equal(stage.shared, null);
  assert.equal(stage.slots, own);
  assert.equal(stage.compare, true);
  assert.equal(stage.target, "b");
  assert.equal(stage.editable, true);
  assert.equal(stage.specs.a.paper, "a4");
  assert.equal(stage.specs.b.paper, "a5");
});

test("a shared page shows alone, on its sender's spec, and nothing may change the pages under it", () => {
  const stage = stageOf(own, layoutOf("compare", "b"), "terminal", sharedOf(["Brief"]));
  assert.equal(stage.editable, false);
  assert.equal(stage.compare, false);
  assert.equal(stage.target, "a");
  assert.equal(stage.layout.mode, "single");
  assert.equal(stage.slots.a.label, "Brief");
  assert.equal(stage.slots.a.readOnly, true);
  assert.equal(stage.specs.a.paper, "a6");
});

test("a shared pair shows as Compare, keeping the reader's active side", () => {
  const stage = stageOf(own, layoutOf("single", "b"), "terminal", sharedOf(["A", "B"]));
  assert.equal(stage.editable, false);
  assert.equal(stage.compare, true);
  assert.equal(stage.layout.mode, "compare");
  assert.equal(stage.layout.compare, true);
  assert.equal(stage.target, "b");
});

test("a shared page's slot is shared, and a single shared page leaves B empty", () => {
  const single = stageOf(own, layoutOf("single", "a"), "terminal", sharedOf(["Brief"]));
  assert.equal(single.slots.a.kind, "shared");
  assert.equal(single.slots.b.kind, "empty");
  assert.equal(single.slots.b.label, null);
  const pair = stageOf(own, layoutOf("single", "a"), "terminal", sharedOf(["A", "B"]));
  assert.equal(pair.slots.a.kind, "shared");
  assert.equal(pair.slots.b.kind, "shared");
  assert.equal(pair.slots.b.label, "B");
  assert.equal(stageOf(own, layoutOf("single", "a"), "terminal", null).slots.a.kind, "library");
});
