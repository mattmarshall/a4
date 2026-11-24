import assert from "node:assert/strict";
import { test } from "node:test";
import { create } from "@bufbuild/protobuf";
import {
  BrowserPlacementSchema,
  ModelCardSchema,
  Operation,
  View,
  type TransformRequest,
} from "../gen/a4/v1/model_pb.js";
import { PRESETS } from "../page/index.ts";
import { Preset } from "../gen/a4/v1/sheet_pb.js";
import { decodeGrid } from "../tensor/codec.ts";
import { implement, type SheetModelHandlers } from "./client.ts";
import { ErrorCode, ModelError } from "./errors.ts";
import { ModelHost } from "./host.ts";
import { FakeWorker } from "./testing/fake-worker.ts";
import { connectPort, fromWorker, servePort } from "./worker-transport.ts";
import { pluginIdOf } from "./plugin-id.ts";

/** A plugin id, minted from a card as the host mints them. */
const pid = (id: string) => pluginIdOf(create(ModelCardSchema, { id }));

const T = PRESETS.terminal;
const lines = (n: number) => Array.from({ length: n }, (_, i) => `line ${i}`).join("\n");

function fake(opts: {
  operations: Operation[];
  views?: View[];
  presets?: Preset[];
  handlers: Partial<SheetModelHandlers>;
  id?: string;
}) {
  const calls: string[] = [];
  const card = create(ModelCardSchema, {
    id: opts.id ?? "fake",
    name: "Fake",
    operations: opts.operations,
    views: opts.views ?? [View.TEXT, View.GRID],
    placement: { case: "browser", value: {} },
    ...(opts.operations.includes(Operation.TRANSFORM) ? { transform: { instructions: ["fit"], maxAttempts: 3 } } : {}),
    ...(opts.presets ? { presets: opts.presets } : {}),
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
        yield {
          event: {
            case: "candidate",
            value: { text: lines(n), resume: new Uint8Array([requests.length]), model: "m" },
          },
        };
      },
    },
  });
  return { ...f, requests };
}

test("operations: an undeclared operation is refused without contacting the plugin", async () => {
  const { host, calls } = fake({ operations: [Operation.SCORE], handlers: { async *transform() {} } });
  await assert.rejects(
    host.transform(pid("fake"), "x", T, { instruction: "fit" }),
    (e: unknown) => e instanceof ModelError && e.code === ErrorCode.UNSUPPORTED_OPERATION,
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
        assert.equal(req.sheet?.text, undefined, "text view not declared, so no text at all");
        assert.equal(req.sheet!.spec!.cols, 80);
        return {};
      },
    },
  });
  await host.score(pid("fake"), "hello\nworld", T);
  assert.equal(seen, "hello\nworld");
});

test("per-cell planes: a 60 × 79 plane for a 60 × 80 grid is rejected", async () => {
  const { host } = fake({
    operations: [Operation.SCORE],
    handlers: {
      score: (req) => ({
        planes: [{ name: "p", shape: [60, 79], values: new Array(60 * 79).fill(0), text: req.sheet?.text ?? "" }],
      }),
    },
  });
  await assert.rejects(
    host.score(pid("fake"), "x", T),
    (e: unknown) => e instanceof ModelError && e.code === ErrorCode.INVALID_RESULT && /60 × 79/.test(e.message),
  );
});

test("per-cell planes: a matching plane is returned with its text and values", async () => {
  const { host } = fake({
    operations: [Operation.SCORE],
    handlers: {
      score: (req) => ({
        planes: [
          {
            name: "heat",
            label: "Heat",
            shape: [60, 80],
            values: Array.from({ length: 4800 }, (_, i) => (i === 0 ? 1 : 0)),
            text: req.sheet?.text ?? "",
          },
        ],
        findings: [{ kind: "restates", spans: [{ start: 0, end: 1 }], value: 0.9, label: "x" }],
      }),
    },
  });
  const result = await host.score(pid("fake"), "x", T);
  assert.equal(result.planes[0].values[0], 1);
  assert.equal(result.planes[0].values.length, 4800);
  assert.equal(result.planes[0].text, "x");
  assert.deepEqual(result.findings[0].spans, [{ start: 0, end: 1 }]);
});

test("per-cell planes: a plane computed for other text is rejected", async () => {
  const { host } = fake({
    operations: [Operation.SCORE],
    handlers: {
      score: () => ({ planes: [{ name: "p", shape: [60, 80], values: new Array(4800).fill(0), text: "stale" }] }),
    },
  });
  await assert.rejects(
    host.score(pid("fake"), "x", T),
    (e: unknown) => e instanceof ModelError && e.code === ErrorCode.INVALID_RESULT,
  );
});

test("host-enforced fit: a result laying out to 63 rows is over by 3", async () => {
  const { host } = rowsPlugin([63]);
  const r = await host.transform(pid("fake"), "src", T, { instruction: "fit", maxAttempts: 1 });
  assert.equal(r.rowsUsed, 63);
  assert.equal(r.fits, false);
  assert.equal(r.overBy, 3);
});

test("fit with repairs: fits on the second attempt, with feedback and resume passed back", async () => {
  const { host, requests } = rowsPlugin([64, 58, 50]);
  const attempts: number[] = [];
  const r = await host.transform(pid("fake"), "src", T, {
    instruction: "fit",
    onAttempt: (a) => attempts.push(a.rowsUsed),
  });
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
  const r = await host.transform(pid("fake"), "src", T, { instruction: "fit" });
  assert.equal(requests.length, 3);
  assert.equal(r.fits, false);
  assert.equal(r.rowsUsed, 63);
  assert.equal(r.overBy, 3);
  assert.equal(r.text, lines(63));
});

test("fit with repairs: keeps the fewest rows even when a later attempt is worse", async () => {
  const { host } = rowsPlugin([66, 70, 68]);
  const r = await host.transform(pid("fake"), "src", T, { instruction: "fit" });
  assert.equal(r.rowsUsed, 66);
  assert.equal(r.overBy, 6);
});

test("a plugin that describes itself under another id is refused", async () => {
  const card = create(ModelCardSchema, {
    id: "real",
    name: "Real",
    operations: [Operation.SCORE],
    placement: { case: "browser", value: {} },
  });
  const host = new ModelHost();
  host.register({ card, connect: async () => implement({ describe: () => ({ card: { ...card, id: "other" } }) }) });
  await assert.rejects(
    host.score(pid("real"), "x", T),
    (e: unknown) => e instanceof ModelError && e.code === ErrorCode.INVALID_CARD,
  );
});

test("a card that sends text off the device must name its destination", () => {
  const host = new ModelHost();
  const card = create(ModelCardSchema, {
    id: "r",
    operations: [Operation.TRANSFORM],
    transform: { instructions: ["fit"], maxAttempts: 3 },
    placement: { case: "remote", value: {} },
  });
  assert.throws(() => host.register({ card, connect: async () => implement({}) }), ModelError);
});

test("a plugin whose worker crashed is reconnected on the next call", async () => {
  const card = create(ModelCardSchema, {
    id: "w",
    name: "Worker",
    operations: [Operation.SCORE],
    views: [View.TEXT],
    placement: { case: "browser", value: {} },
  });
  const workers: FakeWorker[] = [];
  const host = new ModelHost();
  host.register({
    card,
    connect: async () => {
      const worker = new FakeWorker();
      workers.push(worker);
      servePort(worker.channel.port2, implement({ describe: () => ({ card }), score: () => ({}) }));
      return connectPort(fromWorker(worker));
    },
  });
  await host.score(pid("w"), "hello", PRESETS.terminal);
  workers[0]!.crash();
  await host.score(pid("w"), "hello again", PRESETS.terminal);
  assert.equal(workers.length, 2);
  assert.ok(workers[0]!.terminated);
  workers[1]!.terminate();
});

test("changing a card after registration can't turn consent off", async () => {
  const card = create(ModelCardSchema, {
    id: "remote",
    name: "Remote",
    operations: [Operation.TRANSFORM],
    transform: { instructions: ["fit"], maxAttempts: 3 },
    views: [View.TEXT],
    placement: { case: "remote", value: { destinationHost: "api.example.com" } },
  });
  let connected = false;
  const host = new ModelHost();
  host.register({
    card,
    connect: async () => {
      connected = true;
      return implement({ describe: () => ({ card }) });
    },
  });
  card.placement = { case: "browser", value: create(BrowserPlacementSchema) }; // the caller's object, after registration
  await assert.rejects(
    host.transform(pid("remote"), "text", PRESETS.terminal, { instruction: "fit" }),
    (e: unknown) => e instanceof ModelError && e.code === ErrorCode.CONSENT_REQUIRED,
  );
  assert.equal(connected, false);
  // The host's own card can't be changed either.
  const listed = host.list()[0]!;
  assert.ok(Object.isFrozen(listed));
  assert.throws(() => {
    (listed as { placement: unknown }).placement = { case: "browser", value: {} };
  });
  assert.equal(host.card(pid("remote")).placement.case, "remote");
});

test("the host rejects spans outside the page, deep planes, and duplicate plane names", async () => {
  const text = "Short page.";
  const cases: [string, NonNullable<Parameters<typeof implement>[0]["score"]>][] = [
    [
      "span past the end",
      () => ({ findings: [{ kind: "similar", spans: [{ start: 2, end: 120 }], value: 1, label: "x" }] }),
    ],
    [
      "negative span",
      () => ({ findings: [{ kind: "similar", spans: [{ start: -1, end: 3 }], value: 1, label: "x" }] }),
    ],
  ];
  for (const [label, score] of cases) {
    const { host } = fake({ operations: [Operation.SCORE], handlers: { score } });
    await assert.rejects(
      host.score(pid("fake"), text, PRESETS.terminal),
      (e: unknown) => e instanceof ModelError && e.code === ErrorCode.INVALID_RESULT,
      label,
    );
  }
  const grid = (await import("../tensor/codec.ts")).encodeGrid(text, PRESETS.terminal);
  const plane = (name: string, depth: number) => ({
    name,
    text,
    shape: [grid.rows, grid.cols, depth],
    values: new Array(grid.rows * grid.cols * depth).fill(0),
  });
  const deep = fake({ operations: [Operation.SCORE], handlers: { score: () => ({ planes: [plane("p", 2)] }) } });
  await assert.rejects(
    deep.host.score(pid("fake"), text, PRESETS.terminal),
    (e: unknown) => e instanceof ModelError && /depth 2/.test(e.message),
  );
  const twice = fake({
    operations: [Operation.SCORE],
    handlers: { score: () => ({ planes: [plane("p", 1), plane("p", 1)] }) },
  });
  await assert.rejects(
    twice.host.score(pid("fake"), text, PRESETS.terminal),
    (e: unknown) => e instanceof ModelError && /two planes/.test(e.message),
  );
  const ok = fake({
    operations: [Operation.SCORE],
    handlers: {
      score: () => ({
        planes: [plane("p", 1), plane("q", 1)],
        findings: [{ kind: "k", spans: [{ start: 0, end: text.length }], value: 1, label: "" }],
      }),
    },
  });
  const result = await ok.host.score(pid("fake"), text, PRESETS.terminal);
  assert.deepEqual(
    result.planes.map((p) => p.name),
    ["p", "q"],
  );
});

test("the host enforces the card's presets and instructions without contacting the plugin", async () => {
  const picky = fake({
    operations: [Operation.SCORE, Operation.TRANSFORM],
    presets: [Preset.TERMINAL],
    handlers: {
      score: () => ({}),
      async *transform() {
        yield { event: { case: "candidate", value: { text: "ok", model: "m" } } };
      },
    },
  });
  const unsupported = (e: unknown) => e instanceof ModelError && e.code === ErrorCode.UNSUPPORTED_OPERATION;
  await assert.rejects(picky.host.score(pid("fake"), "x", PRESETS.dense), unsupported);
  await assert.rejects(picky.host.transform(pid("fake"), "x", T, { instruction: "summarize" }), unsupported);
  assert.deepEqual(picky.calls, []);
  assert.equal((await picky.host.transform(pid("fake"), "x", T, { instruction: "fit" })).text, "ok");
});

test("a card that transforms must declare its instructions", () => {
  const host = new ModelHost();
  const card = create(ModelCardSchema, {
    id: "t",
    operations: [Operation.TRANSFORM],
    placement: { case: "browser", value: {} },
  });
  assert.throws(
    () => host.register({ card, connect: async () => implement({}) }),
    (e: unknown) => e instanceof ModelError && e.code === ErrorCode.INVALID_CARD,
  );
});

test("sheet views: a text reader receives the text and no grid", async () => {
  const { host } = fake({
    operations: [Operation.SCORE],
    views: [View.TEXT],
    handlers: {
      score(req) {
        assert.equal(req.sheet?.text, "hello");
        assert.equal(req.sheet?.grid, undefined);
        return {};
      },
    },
  });
  await host.score(pid("fake"), "hello", T);
});
