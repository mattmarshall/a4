import assert from "node:assert/strict";
import { test } from "node:test";
import { create, toBinary } from "@bufbuild/protobuf";
import { SheetSchema } from "../gen/a4/v1/sheet_pb.js";
import { PRESETS } from "../page-spec.ts";
import { encodeGrid } from "./codec.ts";
import { pageSpecMessage, readSheet, SheetRecordError, sheetRecord, writeSheet } from "./record.ts";

const T = PRESETS.terminal;

test("sheet record: a consistent record round-trips", () => {
  const bytes = writeSheet(sheetRecord("hello", T));
  const back = readSheet(bytes);
  assert.equal(back.text, "hello");
  assert.equal(back.spec?.preset, "terminal");
  assert.equal(back.spec?.cols, 80);
  assert.equal(back.spec?.rows, 60);
  assert.deepEqual(back.grid, encodeGrid("hello", T));
});

test("sheet record: a corrupt record names the first mismatching row", () => {
  const bad = create(SheetSchema, { spec: pageSpecMessage(T), text: "hello", grid: encodeGrid("help", T) });
  const bytes = toBinary(SheetSchema, bad);
  assert.throws(
    () => readSheet(bytes),
    (error: unknown) => error instanceof SheetRecordError && error.row === 0 && /row 0/.test(error.message),
  );
});

test("sheet record: a mismatch further down names that row", () => {
  const bad = create(SheetSchema, { spec: pageSpecMessage(T), text: "a\nb\nc", grid: encodeGrid("a\nb\nd", T) });
  assert.throws(() => readSheet(toBinary(SheetSchema, bad)), (e: unknown) => e instanceof SheetRecordError && e.row === 2);
});

test("sheet record: missing grid, garbage bytes, and lone surrogates are refused", () => {
  const noGrid = create(SheetSchema, { spec: pageSpecMessage(T), text: "x" });
  assert.throws(() => readSheet(toBinary(SheetSchema, noGrid)), SheetRecordError);
  assert.throws(() => readSheet(new Uint8Array([0xff, 0xff, 0xff])), SheetRecordError);
  assert.throws(() => writeSheet(sheetRecord("bad \uD800", T)), SheetRecordError);
});

test("sheet record: a full Terminal page of ASCII is about 5 KB", () => {
  const text = Array.from({ length: 60 }, () => "m".repeat(80)).join("\n");
  const size = writeSheet(sheetRecord(text, T)).length;
  assert.ok(size > 9_000 && size < 11_000, `unexpected size ${size}`); // text + one varint byte per cell
});
