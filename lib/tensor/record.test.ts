import assert from "node:assert/strict";
import { test } from "node:test";
import { create, toBinary } from "@bufbuild/protobuf";
import { PageSpecSchema, PaperSize, Preset, SheetSchema } from "../gen/a4/v1/sheet_pb.js";
import { pageSpec, PRESETS } from "../page/index.ts";
import { encodeGrid } from "./codec.ts";
import {
  pageSpecMessage,
  pageSpecOf,
  readSheet,
  SheetRecordError,
  sheetRecord,
  verifySheet,
  writeSheet,
} from "./record.ts";

const T = PRESETS.terminal;

test("sheet record: a consistent record round-trips", () => {
  const bytes = writeSheet(sheetRecord("hello", T));
  const back = readSheet(bytes);
  assert.equal(back.text, "hello");
  assert.equal(back.spec?.preset, Preset.TERMINAL);
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
  assert.throws(
    () => readSheet(toBinary(SheetSchema, bad)),
    (e: unknown) => e instanceof SheetRecordError && e.row === 2,
  );
});

test("sheet record: missing grid, garbage bytes, and lone surrogates are refused", () => {
  const noGrid = create(SheetSchema, { spec: pageSpecMessage(T), text: "x" });
  assert.throws(() => readSheet(toBinary(SheetSchema, noGrid)), SheetRecordError);
  assert.throws(() => readSheet(new Uint8Array([0xff, 0xff, 0xff])), SheetRecordError);
  assert.throws(() => writeSheet(sheetRecord("bad \uD800", T)), SheetRecordError);
});

test("sheet record: a full Terminal page of ASCII is about 10 KB", () => {
  const text = Array.from({ length: 60 }, () => "m".repeat(80)).join("\n");
  const size = writeSheet(sheetRecord(text, T)).length;
  assert.ok(size > 9_000 && size < 11_000, `unexpected size ${size}`); // text + one varint byte per cell
});

test("a sheet sent to a plugin may carry one view; it still needs a spec and a consistent grid", () => {
  const spec = pageSpecMessage(T);
  verifySheet(create(SheetSchema, { spec, text: "only text" }));
  verifySheet(create(SheetSchema, { spec, grid: encodeGrid("only grid", T) }));
  assert.throws(() => verifySheet(create(SheetSchema, { spec })), SheetRecordError);
  assert.throws(() => verifySheet(create(SheetSchema, { text: "no spec" })), SheetRecordError);
  assert.throws(
    () => verifySheet(create(SheetSchema, { spec, text: "one text", grid: encodeGrid("another", T) })),
    SheetRecordError,
  );
  assert.throws(
    () => verifySheet(create(SheetSchema, { spec, grid: encodeGrid("too narrow", PRESETS.pica) })),
    SheetRecordError,
  );
});

test("an A5 sheet round-trips with its paper, on its own grid", () => {
  const a5 = pageSpec("terminal", "a5");
  const text = Array.from({ length: 12 }, (_, i) => `Row ${i}`).join("\n");
  const sheet = readSheet(writeSheet(sheetRecord(text, a5)));
  assert.equal(sheet.spec?.paper, PaperSize.A5);
  assert.deepEqual([sheet.grid?.rows, sheet.grid?.cols, sheet.grid?.rowsUsed], [42, 56, 12]);
  assert.equal(sheet.spec && pageSpecOf(sheet.spec), a5);
});

test("a record from before paper sizes reads as A4", () => {
  const old = create(SheetSchema, {
    spec: create(PageSpecSchema, { ...pageSpecMessage(PRESETS.terminal), paper: PaperSize.UNSPECIFIED }),
    text: "hello",
    grid: encodeGrid("hello", PRESETS.terminal),
  });
  const read = readSheet(toBinary(SheetSchema, old));
  assert.equal(read.spec && pageSpecOf(read.spec), PRESETS.terminal);
});

test("a record whose grid disagrees with its preset and paper is refused", () => {
  // Claims A5, but carries the A4 page's 80 x 60 shape.
  const lying = create(SheetSchema, {
    spec: create(PageSpecSchema, { ...pageSpecMessage(PRESETS.terminal), paper: PaperSize.A5 }),
    text: "hello",
    grid: encodeGrid("hello", PRESETS.terminal),
  });
  assert.throws(() => verifySheet(lying), SheetRecordError);
  assert.throws(() => readSheet(toBinary(SheetSchema, lying)), /A5 is 56 x 42/);
});
