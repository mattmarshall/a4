import assert from "node:assert/strict";
import { test } from "node:test";
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { SheetSchema } from "../gen/a4/v1/sheet_pb.js";
import { ModelCardSchema, Operation, Placement } from "../gen/a4/v1/model_pb.js";

test("generated a4.v1 schemas load under type stripping and round-trip", () => {
  const sheet = create(SheetSchema, {
    text: "hi",
    spec: { preset: "terminal", cols: 80, rows: 60 },
    grid: { rows: 60, cols: 80, rowsUsed: 1, cells: [104, 105], rowLengths: [2], continuation: [false] },
  });
  const back = fromBinary(SheetSchema, toBinary(SheetSchema, sheet));
  assert.equal(back.text, "hi");
  assert.equal(back.spec?.cols, 80);
  assert.deepEqual(back.grid?.cells, [104, 105]);

  const card = create(ModelCardSchema, { id: "x", operations: [Operation.SCORE], placement: Placement.BROWSER });
  assert.deepEqual(fromBinary(ModelCardSchema, toBinary(ModelCardSchema, card)).operations, [Operation.SCORE]);
});
