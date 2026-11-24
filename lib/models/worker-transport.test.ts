import assert from "node:assert/strict";
import { test } from "node:test";
import { create } from "@bufbuild/protobuf";
import {
  DescribeRequestSchema,
  ModelCardSchema,
  Operation,
  Placement,
  ScoreRequestSchema,
} from "../gen/a4/v1/model_pb.js";
import { PRESETS } from "../page-spec.ts";
import { sheetRecord } from "../tensor/record.ts";
import { implement } from "./client.ts";
import { ModelError } from "./errors.ts";
import { FakeWorker } from "./testing/fake-worker.ts";
import { connectPort, fromWorker, isClosed, servePort, type PortLike } from "./worker-transport.ts";

const card = create(ModelCardSchema, {
  id: "echo",
  name: "Echo",
  operations: [Operation.SCORE],
  placement: Placement.BROWSER,
});

function pair(handlers: Parameters<typeof implement>[0]) {
  const channel = new MessageChannel();
  const stop = servePort(channel.port2 as unknown as PortLike, implement({ describe: () => ({ card }), ...handlers }));
  const client = connectPort(channel.port1 as unknown as PortLike);
  const close = () => {
    stop();
    channel.port1.close();
    channel.port2.close();
  };
  return { client, close };
}

test("worker transport: Describe and Score round-trip as protobuf frames", async () => {
  const { client, close } = pair({
    score: (req) => ({
      planes: [
        { name: "len", shape: [60, 80], values: new Array(4800).fill(req.sheet!.text.length), text: req.sheet!.text },
      ],
      scores: [{ name: "chars", value: req.sheet!.text.length }],
    }),
  });
  try {
    const described = await client.describe(create(DescribeRequestSchema));
    assert.equal(described.card?.id, "echo");
    assert.deepEqual(described.card?.operations, [Operation.SCORE]);

    const response = await client.score(create(ScoreRequestSchema, { sheet: sheetRecord("hello", PRESETS.terminal) }));
    assert.equal(response.scores[0].value, 5);
    assert.equal(response.planes[0].values.length, 4800);
    assert.equal(response.planes[0].text, "hello");
  } finally {
    close();
  }
});

test("worker transport: streaming replies arrive in order, then end", async () => {
  const { client, close } = pair({
    async *prepare() {
      for (let i = 1; i <= 3; i++) yield { loadedBytes: BigInt(i * 10), totalBytes: BigInt(30), ready: i === 3 };
    },
  });
  try {
    const seen: number[] = [];
    for await (const event of client.prepare(create((await import("../gen/a4/v1/model_pb.js")).PrepareRequestSchema))) {
      seen.push(Number(event.loadedBytes));
    }
    assert.deepEqual(seen, [10, 20, 30]);
  } finally {
    close();
  }
});

test("worker transport: plugin errors keep their code across the port", async () => {
  const { client, close } = pair({
    score: () => {
      throw new ModelError("not-ready", "Download the model first.");
    },
  });
  try {
    await assert.rejects(
      client.score(create(ScoreRequestSchema)),
      (e: unknown) => e instanceof ModelError && e.code === "not-ready" && e.message === "Download the model first.",
    );
    await assert.rejects(
      client.encode(create((await import("../gen/a4/v1/model_pb.js")).EncodeRequestSchema)),
      (e: unknown) => e instanceof ModelError && e.code === "unimplemented",
    );
  } finally {
    close();
  }
});

test("worker transport: aborting a call cancels it on the server", async () => {
  let serverAborted = false;
  const { client, close } = pair({
    score: (_req, signal) =>
      new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () => {
          serverAborted = true;
          reject(new Error("aborted"));
        });
      }),
  });
  try {
    const controller = new AbortController();
    const call = client.score(create(ScoreRequestSchema), controller.signal);
    setTimeout(() => controller.abort(), 10);
    await assert.rejects(call, (e: unknown) => e instanceof ModelError && e.code === "cancelled");
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(serverAborted, true);
  } finally {
    close();
  }
});

test("worker transport: an all-default unary reply (zero bytes) still resolves", async () => {
  const { StatusRequestSchema } = await import("../gen/a4/v1/model_pb.js");
  const { client, close } = pair({ status: () => ({ ready: false }) });
  try {
    const response = await client.status(create(StatusRequestSchema));
    assert.equal(response.ready, false);
  } finally {
    close();
  }
});

test("worker transport: a crashed worker fails pending calls at once, and later calls too", async () => {
  const worker = new FakeWorker();
  let release: () => void = () => {};
  servePort(
    worker.channel.port2 as unknown as PortLike,
    implement({
      describe: () => ({ card }),
      score: () => new Promise((resolve) => (release = () => resolve({}))),
    }),
  );
  const client = connectPort(fromWorker(worker));
  const scoring = client.score(create(ScoreRequestSchema, { sheet: sheetRecord("x", PRESETS.terminal) }));
  await new Promise((r) => setTimeout(r, 20));
  const started = Date.now();
  worker.crash();
  await assert.rejects(scoring, (e: unknown) => e instanceof ModelError && e.code === "unavailable");
  assert.ok(Date.now() - started < 1000);
  assert.ok(worker.terminated);
  assert.ok(isClosed(client));
  await assert.rejects(
    client.describe(create(DescribeRequestSchema)),
    (e: unknown) => e instanceof ModelError && e.code === "unavailable",
  );
  release();
});

test("worker transport: an unreadable message from the worker also fails the client", async () => {
  const worker = new FakeWorker();
  const client = connectPort(fromWorker(worker));
  const pending = client.describe(create(DescribeRequestSchema));
  worker.dispatchEvent(new MessageEvent("messageerror"));
  await assert.rejects(pending, (e: unknown) => e instanceof ModelError && e.code === "unavailable");
});
