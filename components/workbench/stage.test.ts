import assert from "node:assert/strict";
import { test } from "node:test";
import { pageSpec } from "../../lib/page/index.ts";
import type { SharedPageView } from "../../lib/share/index.ts";
import type { SlotSnapshot } from "../../lib/workspace/index.ts";
import { stageOf } from "./stage.ts";
import type { Layout } from "./useLayout";
import type { SharedView } from "./useSharedView";

function slot(label: string | null, text = ""): SlotSnapshot {
  return { ref: null, name: null, label, text, status: "saved", readOnly: false };
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
  const shown = (name: string | undefined) => ({ ...slot(null, "shared"), label: name ?? null, readOnly: true });
  return {
    pages,
    seals: pages.map(() => ({ kind: "none" })),
    slots: { a: shown(names[0]), b: shown(names[1]) },
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
