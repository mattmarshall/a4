import { test } from "node:test";
import assert from "node:assert/strict";
import { create } from "@bufbuild/protobuf";
import { PrepareRequestSchema, StatusRequestSchema } from "../../../gen/a4/v1/model_pb.js";
import { PRESETS } from "../../../page/index.ts";
import { ErrorCode, ModelError } from "../../errors.ts";
import { ModelHost } from "../../host.ts";
import { connectPort, servePort } from "../../worker-transport.ts";
import { SEMANTIC_REPETITION } from "./descriptor.ts";
import { createSemanticPlugin, type Extractor, type InferenceLibrary } from "./plugin.ts";

const T = PRESETS.terminal;
const { id, card, names } = SEMANTIC_REPETITION;

/** Bag-of-words vectors: sentences with the same words, in any order, are identical. */
const extractor: Extractor = async (texts) => {
  const vocabulary = [...new Set(texts.flatMap((t) => t.toLowerCase().match(/\p{L}+/gu) ?? []))].sort();
  const data = new Float32Array(texts.length * vocabulary.length);
  texts.forEach((t, i) => {
    const words = t.toLowerCase().match(/\p{L}+/gu) ?? [];
    for (const w of words) data[i * vocabulary.length + vocabulary.indexOf(w)] += 1;
    const row = data.subarray(i * vocabulary.length, (i + 1) * vocabulary.length);
    const norm = Math.hypot(...row) || 1;
    for (let j = 0; j < row.length; j++) row[j] = (row[j] ?? 0) / norm;
  });
  return { data, dims: [texts.length, vocabulary.length] };
};

function fakeLibrary(options: { fail?: boolean } = {}) {
  const calls = { imports: 0, pipelines: 0 };
  const importLibrary = async (): Promise<InferenceLibrary> => {
    calls.imports++;
    if (options.fail) throw new Error("offline");
    return {
      pipeline: async (_task, _model, { progress_callback }) => {
        calls.pipelines++;
        progress_callback({ status: "progress", file: "model.onnx", loaded: 1000 });
        progress_callback({ status: "progress", file: "tokenizer.json", loaded: 200 });
        return extractor;
      },
    };
  };
  return { importLibrary, calls };
}

/** The plugin served over a MessageChannel, and a host connected to it. */
function served(deps: Parameters<typeof createSemanticPlugin>[0]) {
  const channel = new MessageChannel();
  const stop = servePort(channel.port2, createSemanticPlugin(deps));
  const client = connectPort(channel.port1);
  const host = new ModelHost();
  host.register({ card, connect: async () => client });
  return {
    client,
    host,
    close() {
      stop();
      channel.port1.close();
      channel.port2.close();
    },
  };
}

const PAGE = [
  "The export moved two hours earlier for finance.",
  "Finance asked for the export two hours earlier.",
  "Watch the first three runs closely for timeouts.",
].join("\n");

test("not downloaded: status is not ready, and scoring asks for the download first", async () => {
  const lib = fakeLibrary();
  const s = served({ importLibrary: lib.importLibrary, isCached: async () => false });
  try {
    assert.equal((await s.client.status(create(StatusRequestSchema))).ready, false);
    await assert.rejects(
      s.host.score(id, PAGE, T),
      (e: unknown) => e instanceof ModelError && e.code === ErrorCode.NOT_READY,
    );
    assert.equal(lib.calls.pipelines, 0);
  } finally {
    s.close();
  }
});

test("prepare reports progress, then ready; scoring then works through the host", async () => {
  const lib = fakeLibrary();
  const s = served({ importLibrary: lib.importLibrary, isCached: async () => false });
  try {
    const events: { loaded: number; ready: boolean }[] = [];
    for await (const e of s.client.prepare(create(PrepareRequestSchema))) {
      events.push({ loaded: Number(e.loadedBytes), ready: e.ready });
    }
    assert.deepEqual(
      events.slice(0, 2).map((e) => e.loaded),
      [1000, 1200],
    );
    assert.equal(events.at(-1)?.ready, true);
    assert.equal((await s.client.status(create(StatusRequestSchema))).ready, true);

    const result = await s.host.score(id, PAGE, T);
    assert.equal(result.planes[0]?.name, names.plane);
    assert.equal(result.planes[0]?.values.length, (result.planes[0]?.rows ?? 0) * T.cols);
    const score = (name: string) => result.scores.find((x) => x.name === name)?.value;
    assert.equal(score(names.scores.units), 3);
    assert.equal(score(names.scores.restating), 2, "both sentences of the pair restate the other");
    assert.equal(result.findings[0]?.kind, names.findings.similar);
    assert.equal(result.findings[0]?.label, "Finance asked for the export two hours earlier.");
    assert.equal(lib.calls.imports, 1, "the library is imported once");
  } finally {
    s.close();
  }
});

test("already downloaded: ready at once, and scoring loads from the cache without a prepare", async () => {
  const lib = fakeLibrary();
  const s = served({ importLibrary: lib.importLibrary, isCached: async () => true });
  try {
    assert.equal((await s.client.status(create(StatusRequestSchema))).ready, true);
    const result = await s.host.score(id, PAGE, T);
    assert.equal(result.scores.length, 2);
    assert.equal(lib.calls.pipelines, 1);
  } finally {
    s.close();
  }
});

test("a failed download is a network error, and a later prepare tries again", async () => {
  const lib = fakeLibrary({ fail: true });
  const s = served({ importLibrary: lib.importLibrary, isCached: async () => false });
  try {
    const prepare = async () => {
      for await (const _ of s.client.prepare(create(PrepareRequestSchema))) {
        // drain
      }
    };
    await assert.rejects(prepare, (e: unknown) => e instanceof ModelError && e.code === ErrorCode.NETWORK);
    await assert.rejects(prepare, (e: unknown) => e instanceof ModelError && e.code === ErrorCode.NETWORK);
    assert.equal(lib.calls.imports, 2);
  } finally {
    s.close();
  }
});
