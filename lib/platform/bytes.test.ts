import assert from "node:assert/strict";
import { test } from "node:test";
import {
  deflateRaw,
  fromBase64,
  fromBase64Url,
  inflateRaw,
  readCapped,
  sameBytes,
  toBase64,
  toBase64Url,
  toHex,
} from "./bytes.ts";

function chunked(...chunks: number[][]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new Uint8Array(chunk));
      controller.close();
    },
  });
}

test("readCapped joins the chunks, reports progress, and gives up past its limit", async () => {
  const seen: number[] = [];
  assert.deepEqual(await readCapped(chunked([1, 2], [3]), 3, (n) => seen.push(n)), new Uint8Array([1, 2, 3]));
  assert.deepEqual(seen, [2, 3]);
  assert.equal(await readCapped(chunked([1, 2], [3]), 2), null);
  assert.equal(await readCapped(chunked([1, 2], [3]), BigInt(2)), null);
});

test("raw DEFLATE round-trips, and inflating stops at its limit", async () => {
  const text = new TextEncoder().encode("one page ".repeat(200));
  const packed = await deflateRaw(text);
  assert.ok(packed.length < text.length);
  assert.deepEqual(await inflateRaw(packed, text.length), text);
  assert.equal(await inflateRaw(packed, text.length - 1), null);
  await assert.rejects(inflateRaw(new Uint8Array([0xff, 0xff, 0xff]), 100));
});

test("base64 and base64url round-trip, and refuse what isn't theirs", () => {
  const bytes = new Uint8Array([0xfb, 0xff, 0x00, 0x3e]);
  assert.equal(toBase64(bytes), "+/8APg==");
  assert.equal(toBase64Url(bytes), "-_8APg");
  assert.deepEqual(fromBase64("+/8APg=="), bytes);
  assert.deepEqual(fromBase64Url("-_8APg"), bytes);
  assert.equal(fromBase64Url("+/8APg"), null);
  assert.equal(fromBase64("not base64!"), null);
});

test("hex and equality", () => {
  assert.equal(toHex(new Uint8Array([0, 10, 255])), "000aff");
  assert.ok(sameBytes(new Uint8Array([1, 2]), new Uint8Array([1, 2])));
  assert.ok(!sameBytes(new Uint8Array([1, 2]), new Uint8Array([1, 3])));
  assert.ok(!sameBytes(new Uint8Array([1]), new Uint8Array([1, 2])));
});
