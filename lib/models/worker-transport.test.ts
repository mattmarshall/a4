import assert from "node:assert/strict";
import { test } from "node:test";
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import {
  DescribeRequestSchema,
  ModelCardSchema,
  Operation,
  Placement,
  ScoreRequestSchema,
} from "../gen/a4/v1/model_pb.js";
import { RpcFrameSchema, type RpcFrame } from "../gen/a4/v1/rpc_pb.js";
import { PRESETS } from "../page-spec.ts";
import { sheetRecord } from "../tensor/record.ts";
import { implement } from "./client.ts";
import { ErrorCode, ModelError } from "./errors.ts";
import { FakeWorker } from "./testing/fake-worker.ts";
import { connectPort, fromWorker, isClosed, servePort } from "./worker-transport.ts";

const card = create(ModelCardSchema, {
  id: "echo",
  name: "Echo",
  operations: [Operation.SCORE],
  placement: Placement.BROWSER,
});

function pair(handlers: Parameters<typeof implement>[0]) {
  const channel = new MessageChannel();
  const stop = servePort(channel.port2, implement({ describe: () => ({ card }), ...handlers }));
  const client = connectPort(channel.port1);
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
      throw new ModelError(ErrorCode.NOT_READY, "Download the model first.");
    },
  });
  try {
    await assert.rejects(
      client.score(create(ScoreRequestSchema)),
      (e: unknown) =>
        e instanceof ModelError && e.code === ErrorCode.NOT_READY && e.message === "Download the model first.",
    );
    await assert.rejects(
      client.encode(create((await import("../gen/a4/v1/model_pb.js")).EncodeRequestSchema)),
      (e: unknown) => e instanceof ModelError && e.code === ErrorCode.UNIMPLEMENTED,
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
    await assert.rejects(call, (e: unknown) => e instanceof ModelError && e.code === ErrorCode.CANCELED);
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
    worker.channel.port2,
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
  await assert.rejects(scoring, (e: unknown) => e instanceof ModelError && e.code === ErrorCode.UNAVAILABLE);
  assert.ok(Date.now() - started < 1000);
  assert.ok(worker.terminated);
  assert.ok(isClosed(client));
  await assert.rejects(
    client.describe(create(DescribeRequestSchema)),
    (e: unknown) => e instanceof ModelError && e.code === ErrorCode.UNAVAILABLE,
  );
  release();
});

test("worker transport: an unreadable message from the worker also fails the client", async () => {
  const worker = new FakeWorker();
  const client = connectPort(fromWorker(worker));
  const pending = client.describe(create(DescribeRequestSchema));
  worker.dispatchEvent(new MessageEvent("messageerror"));
  await assert.rejects(pending, (e: unknown) => e instanceof ModelError && e.code === ErrorCode.UNAVAILABLE);
});

/** The raw frames a port receives, decoded. */
function frames(port: MessagePort): RpcFrame[] {
  const out: RpcFrame[] = [];
  port.addEventListener("message", (event: MessageEvent) => {
    out.push(fromBinary(RpcFrameSchema, new Uint8Array(event.data as ArrayBuffer)));
  });
  port.start();
  return out;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

test("worker transport: an undecodable request with an id gets an error reply", async () => {
  const channel = new MessageChannel();
  const stop = servePort(channel.port2, implement({ describe: () => ({ card }) }));
  const replies = frames(channel.port1);
  try {
    // Field 1 (id 7), then bytes that aren't a valid frame.
    channel.port1.postMessage(new Uint8Array([0x08, 0x07, 0xff, 0xff, 0xff]).buffer);
    // A frame with an id and nothing else.
    channel.port1.postMessage(toBinary(RpcFrameSchema, create(RpcFrameSchema, { id: 9 })).slice().buffer);
    // Not a frame at all: no id to answer.
    channel.port1.postMessage("hello");
    await settle();
    assert.deepEqual(
      replies.map((f) => [f.id, f.kind.case, f.kind.case === "error" ? f.kind.value.code : null]),
      [
        [7, "error", ErrorCode.UNREADABLE],
        [9, "error", ErrorCode.UNREADABLE],
      ],
    );
  } finally {
    stop();
    channel.port1.close();
    channel.port2.close();
  }
});

test("worker transport: an unknown method gets an unimplemented reply", async () => {
  const channel = new MessageChannel();
  const stop = servePort(channel.port2, implement({ describe: () => ({ card }) }));
  const replies = frames(channel.port1);
  try {
    const call = create(RpcFrameSchema, { id: 3, kind: { case: "call", value: { method: "teleport" } } });
    channel.port1.postMessage(toBinary(RpcFrameSchema, call).slice().buffer);
    await settle();
    assert.equal(replies[0]?.kind.case === "error" ? replies[0].kind.value.code : null, ErrorCode.UNIMPLEMENTED);
  } finally {
    stop();
    channel.port1.close();
    channel.port2.close();
  }
});

test("worker transport: a reply that can't be decoded ends its call instead of hanging", async () => {
  const channel = new MessageChannel();
  const client = connectPort(channel.port1);
  const requests = frames(channel.port2);
  channel.port2.addEventListener("message", () => {
    const id = requests.at(-1)?.id ?? 0;
    channel.port2.postMessage(new Uint8Array([0x08, id, 0xff, 0xff]).buffer);
  });
  try {
    await assert.rejects(
      client.describe(create(DescribeRequestSchema)),
      (e: unknown) => e instanceof ModelError && e.code === ErrorCode.UNREADABLE,
    );
  } finally {
    channel.port1.close();
    channel.port2.close();
  }
});
