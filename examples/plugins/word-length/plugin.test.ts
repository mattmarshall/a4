import { test } from "node:test";
import assert from "node:assert/strict";
import { create } from "@bufbuild/protobuf";
import { DescribeRequestSchema, ScoreRequestSchema } from "../../../lib/gen/a4/v1/model_pb.js";
import { startPlugin } from "../../../lib/models/kit/testing/start.ts";
import { PRESETS } from "../../../lib/page/index.ts";
import { sheetRecord } from "../../../lib/tensor/record.ts";
import card from "./card.json" with { type: "json" };
import { handlers, PLANE, wordSpans } from "./plugin.ts";

test("each word's value is its length over 12, capped at 1", () => {
  assert.deepEqual(wordSpans("a word, internationalization"), [
    { start: 0, end: 1, value: 1 / 12 },
    { start: 2, end: 6, value: 4 / 12 },
    { start: 8, end: 28, value: 1 },
  ]);
});

test("Word length describes itself with its card and scores a page cell by cell", async () => {
  const { client, close } = startPlugin(card, handlers);
  try {
    assert.equal((await client.describe(create(DescribeRequestSchema))).card?.id, "example.word-length");
    const text = "Deploy notes\nThe internationalization pass";
    const response = await client.score(create(ScoreRequestSchema, { sheet: sheetRecord(text, PRESETS.terminal) }));
    const plane = response.planes[0];
    assert.equal(plane?.name, PLANE);
    assert.equal(plane?.text, text);
    assert.deepEqual(plane?.shape, [60, 80]);
    const values = plane?.values ?? [];
    assert.ok(Math.abs((values[0] ?? 0) - 6 / 12) < 1e-6, "“Deploy” is 6 letters");
    assert.equal(values[6], 0, "the space between words is untinted");
    assert.equal(values[80 + 4], 1, "“internationalization” is capped at 1");
  } finally {
    close();
  }
});
