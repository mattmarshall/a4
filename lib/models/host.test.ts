import assert from "node:assert/strict";
import { test } from "node:test";
import { create } from "@bufbuild/protobuf";
import { ModelCardSchema, Operation, Placement, View, type TransformRequest } from "../gen/a4/v1/model_pb.js";
import { PRESETS } from "../page-spec.ts";
import { decodeGrid } from "../tensor/codec.ts";
import { implement, type SheetModelHandlers } from "./client.ts";
import { ModelError } from "./errors.ts";
import { ModelHost } from "./host.ts";

const T = PRESETS.terminal;
const lines = (n: number) => Array.from({ length: n }, (_, i) => `line ${i}`).join("\n");

function fake(opts: { operations: Operation[]; views?: View[]; handlers: Partial<SheetModelHandlers>; id?: string }) {
  const calls: string[] = [];
  const card = create(ModelCardSchema, {
    id: opts.id ?? "fake",
    name: "Fake",
    operations: opts.operations,
    views: opts.views ?? [View.TEXT, View.GRID],
    placement: Placement.BROWSER,
  });
  const handlers: Partial<SheetModelHandlers> = {
    describe: () => ({ card }),
    ...opts.handlers,
  };
  const host = new ModelHost();
  host.register({
    card,
    connect: async () => {
      calls.push("connect");
      const client = implement(handlers);
      return new Proxy(client, {
        get(target, prop, receiver) {
          if (typeof prop === "string" && prop !== "describe") calls.push(prop);
          return Reflect.get(target, prop, receiver);
        },
      });
    },
  });
  return { host, calls, card };
}

/** A transform plugin that returns the given row counts, recording requests. */
function rowsPlugin(counts: number[]) {
  const requests: TransformRequest[] = [];
  const f = fake({
    operations: [Operation.TRANSFORM],
    handlers: {
      async *transform(req) {
        requests.push(req);
        const n = counts[requests.length - 1];
        yield { event: { case: "progress", value: { characters: n } } };
        yield { event: { case: "candidate", value: { text: lines(n), resume: new Uint8Array([requests.length]), model: "m" } } };
      },
    },
  });
  return { ...f, requests };
}

test("operations: an undeclared operation is refused without contacting the plugin", async () => {
  const { host, calls } = fake({ operations: [Operation.SCORE], handlers: { async *transform() {} } });
  await assert.rejects(
    host.transform("fake", "x", T, { instruction: "fit" }),
    (e: unknown) => e instanceof ModelError && e.code === "unsupported-operation",
  );
  assert.deepEqual(calls, []);
});

test("sheet views: a grid reader receives a grid that decodes to the page text", async () => {
  let seen = "";
  const { host } = fake({
    operations: [Operation.SCORE],
    views: [View.GRID],
    handlers: {
      score(req) {
        seen = decodeGrid(req.sheet!.grid!);
        assert.equal(req.sheet!.text, "", "text view not declared, so no text");
        assert.equal(req.sheet!.spec!.cols, 80);
        return {};
      },
    },
  });
  await host.score("fake", "hello\nworld", T);
  assert.equal(seen, "hello\nworld");
});

test("per-cell planes: a 60 × 79 plane for a 60 × 80 grid is rejected", async () => {
  const { host } = fake({
    operations: [Operation.SCORE],
    handlers: { score: (req) => ({ planes: [{ name: "p", shape: [60, 79], values: new Array(60 * 79).fill(0), text: req.sheet!.text }] }) },
  });
  await assert.rejects(host.score("fake", "x", T), (e: unknown) => e instanceof ModelError && e.code === "invalid-result" && /60 × 79/.test(e.message));
});

test("per-cell planes: a matching plane is returned with its text and values", async () => {
  const { host } = fake({
    operations: [Operation.SCORE],
    handlers: {
      score: (req) => ({
        planes: [{ name: "heat", label: "Heat", shape: [60, 80], values: Array.from({ length: 4800 }, (_, i) => (i === 0 ? 1 : 0)), text: req.sheet!.text }],
        findings: [{ kind: "restates", spans: [{ start: 0, end: 1 }], value: 0.9, label: "x" }],
      }),
    },
  });
  const result = await host.score("fake", "x", T);
  assert.equal(result.planes[0].values[0], 1);
  assert.equal(result.planes[0].values.length, 4800);
  assert.equal(result.planes[0].text, "x");
  assert.deepEqual(result.findings[0].spans, [{ start: 0, end: 1 }]);
});

test("per-cell planes: a plane computed for other text is rejected", async () => {
  const { host } = fake({
    operations: [Operation.SCORE],
    handlers: { score: () => ({ planes: [{ name: "p", shape: [60, 80], values: new Array(4800).fill(0), text: "stale" }] }) },
  });
  await assert.rejects(host.score("fake", "x", T), (e: unknown) => e instanceof ModelError && e.code === "invalid-result");
});

test("host-enforced fit: a result laying out to 63 rows is over by 3", async () => {
  const { host } = rowsPlugin([63]);
  const r = await host.transform("fake", "src", T, { instruction: "fit", maxAttempts: 1 });
  assert.equal(r.rowsUsed, 63);
  assert.equal(r.fits, false);
  assert.equal(r.overBy, 3);
});

test("fit with repairs: fits on the second attempt, with feedback and resume passed back", async () => {
  const { host, requests } = rowsPlugin([64, 58, 50]);
  const attempts: number[] = [];
  const r = await host.transform("fake", "src", T, { instruction: "fit", onAttempt: (a) => attempts.push(a.rowsUsed) });
  assert.equal(r.fits, true);
  assert.equal(r.rowsUsed, 58);
  assert.equal(r.attempts, 2);
  assert.equal(requests.length, 2, "no third attempt");
  assert.deepEqual(attempts, [64, 58]);
  assert.equal(requests[0].feedback, undefined);
  assert.equal(requests[1].feedback?.rowsUsed, 64);
  assert.equal(requests[1].feedback?.rowsAllowed, 60);
  assert.deepEqual([...requests[1].resume], [1], "resume from attempt 1 passed back unchanged");
  assert.equal(requests[1].attempt, 2);
});

test("fit with repairs: never fits, keeps the 63-row attempt, over by 3", async () => {
  const { host, requests } = rowsPlugin([70, 66, 63]);
  const r = await host.transform("fake", "src", T, { instruction: "fit" });
  assert.equal(requests.length, 3);
  assert.equal(r.fits, false);
  assert.equal(r.rowsUsed, 63);
  assert.equal(r.overBy, 3);
  assert.equal(r.text, lines(63));
});

test("fit with repairs: keeps the fewest rows even when a later attempt is worse", async () => {
  const { host } = rowsPlugin([66, 70, 68]);
  const r = await host.transform("fake", "src", T, { instruction: "fit" });
  assert.equal(r.rowsUsed, 66);
  assert.equal(r.overBy, 6);
});

test("a plugin that describes itself under another id is refused", async () => {
  const card = create(ModelCardSchema, { id: "real", name: "Real", operations: [Operation.SCORE], placement: Placement.BROWSER });
  const host = new ModelHost();
  host.register({ card, connect: async () => implement({ describe: () => ({ card: { ...card, id: "other" } }) }) });
  await assert.rejects(host.score("real", "x", T), (e: unknown) => e instanceof ModelError && e.code === "invalid-result");
});

test("a card that sends text off the device must name its destination", () => {
  const host = new ModelHost();
  const card = create(ModelCardSchema, { id: "r", operations: [Operation.TRANSFORM], placement: Placement.REMOTE, sendsTextOffDevice: true });
  assert.throws(() => host.register({ card, connect: async () => implement({}) }), ModelError);
});
