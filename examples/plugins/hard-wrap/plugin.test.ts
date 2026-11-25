import { test } from "node:test";
import assert from "node:assert/strict";
import { create } from "@bufbuild/protobuf";
import { TransformRequestSchema } from "../../../lib/gen/a4/v1/model_pb.js";
import { startPlugin } from "../../../lib/models/kit/testing/start.ts";
import { pageFit, PRESETS } from "../../../lib/page/index.ts";
import { sheetRecord } from "../../../lib/tensor/record.ts";
import card from "./card.json" with { type: "json" };
import { handlers, hardWrap } from "./plugin.ts";

const long =
  "The deploy runs every weekday at nine, after the integration suite passes on main and the release owner signs off.";

test("long lines wrap at 72 columns, list items hang under their text, and code blocks stay", () => {
  const text = ["# Notes", long, `- ${long}`, "```", `const x = "${"y".repeat(90)}";`, "```"].join("\n");
  const lines = hardWrap(text).split("\n");
  const outside = lines.filter((l) => !l.includes("yyyy"));
  for (const line of outside) assert.ok(line.length <= 72, `${line.length}: ${line}`);
  assert.ok(lines.includes(`const x = "${"y".repeat(90)}";`), "the code line is unchanged");
  const item = lines.findIndex((l) => l.startsWith("- The deploy"));
  assert.ok(item > 0);
  assert.match(lines[item + 1] ?? "", /^ {2}\S/, "a continuation hangs under the item's text");
  assert.equal(hardWrap("short\nlines"), "short\nlines");
});

test("Hard wrap returns one candidate that fits the page", async () => {
  const { client, close } = startPlugin(card, handlers);
  try {
    const text = Array.from({ length: 8 }, () => long).join("\n");
    const events = [];
    for await (const event of client.transform(
      create(TransformRequestSchema, {
        sheet: sheetRecord(text, PRESETS.terminal),
        instruction: "Wrap at 72 columns",
        attempt: 1,
      }),
    )) {
      events.push(event);
    }
    const candidate = events.find((e) => e.event.case === "candidate");
    assert.ok(candidate?.event.case === "candidate");
    const wrapped = candidate.event.value.text;
    assert.equal(wrapped, hardWrap(text));
    assert.equal(pageFit(wrapped, PRESETS.terminal).fits, true);
  } finally {
    close();
  }
});
