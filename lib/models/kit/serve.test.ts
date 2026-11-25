import { test } from "node:test";
import assert from "node:assert/strict";
import { create } from "@bufbuild/protobuf";
import { DescribeRequestSchema, ScoreRequestSchema } from "../../gen/a4/v1/model_pb.js";
import { PRESETS } from "../../page/index.ts";
import { encodeGrid } from "../../tensor/codec.ts";
import { sheetRecord } from "../../tensor/record.ts";
import { spanPlane } from "./serve.ts";
import { startPlugin } from "./testing/start.ts";

const CARD = {
  id: "example.kit-test",
  name: "Kit test",
  version: "1.0.0",
  operations: ["OPERATION_SCORE"],
  views: ["VIEW_TEXT"],
  browser: {},
};

const started = (handlers: Parameters<typeof startPlugin>[1], start: Parameters<typeof startPlugin>[2] = {}) =>
  startPlugin(CARD, handlers, start);

test("the kit describes the plugin with its own card", async () => {
  const { client, close } = started(() => ({}));
  try {
    const described = await client.describe(create(DescribeRequestSchema));
    assert.equal(described.card?.id, "example.kit-test");
    assert.equal(described.card?.version, "1.0.0");
  } finally {
    close();
  }
});

test("the plugin gets the start files and only the credentials sent, and scores a page", async () => {
  const model = new TextEncoder().encode("weights");
  let seen: { file: string | null; missing: Uint8Array | null; key: string | null; other: string | null } | null = null;
  const { client, close } = started(
    (runtime) => ({
      score: (request) => {
        const file = runtime.file("https://models.example.com/w.bin");
        seen = {
          file: file ? new TextDecoder().decode(file) : null,
          missing: runtime.file("https://models.example.com/other.bin"),
          key: runtime.credential("api-key"),
          other: runtime.credential("token"),
        };
        const text = request.sheet?.text ?? "";
        return {
          planes: [{ name: "p", text, ...spanPlane(text, PRESETS.terminal, [{ start: 0, end: 5, value: 1 }]) }],
        };
      },
    }),
    { files: [{ url: "https://models.example.com/w.bin", data: model }], credentials: { "api-key": "k-123" } },
  );
  try {
    const response = await client.score(
      create(ScoreRequestSchema, { sheet: sheetRecord("hello world", PRESETS.terminal) }),
    );
    assert.deepEqual(seen, { file: "weights", missing: null, key: "k-123", other: null });
    const plane = response.planes[0];
    const grid = encodeGrid("hello world", PRESETS.terminal);
    assert.deepEqual(plane?.shape, [grid.rows, grid.cols]);
    assert.deepEqual(plane?.values.slice(0, 6), [1, 1, 1, 1, 1, 0]);
  } finally {
    close();
  }
});

test("a span on a wrapped line lands in the right cells", () => {
  const text = `${"a".repeat(85)} b`;
  const { shape, values } = spanPlane(text, PRESETS.terminal, [{ start: 86, end: 87, value: 0.5 }]);
  assert.deepEqual(shape, [60, 80]);
  // "a"×85 wraps after 80 columns; " b" starts row 1 at column 5, so "b" is at column 6.
  assert.equal(values[80 + 6], 0.5);
  assert.equal(values.filter((v) => v > 0).length, 1);
});
