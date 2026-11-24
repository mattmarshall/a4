import { test } from "node:test";
import assert from "node:assert/strict";
import { analyze } from "./analyze.ts";
import { heatLevel, LENSES, segmentsFor } from "./lenses.ts";
import { PRESETS } from "./page-spec.ts";
import { INCIDENT_JSON, WELCOME } from "./samples.ts";

const T = PRESETS.terminal;

test("every lens covers the text exactly, without altering it", () => {
  for (const text of [WELCOME, INCIDENT_JSON, "", "a\n\n b  "]) {
    const a = analyze(text, T);
    for (const lens of LENSES) {
      const joined = segmentsFor(lens.id, text, a)
        .map((s) => s.text)
        .join("");
      assert.equal(joined, text, `${lens.id}`);
    }
  }
});

test("syntax lens emphasizes braces and quotes, dims letters and digits", () => {
  const text = '{"a": 1}';
  const segs = segmentsFor("syntax", text, analyze(text, T));
  const styleAt = (i: number): string | undefined => {
    let pos = 0;
    for (const s of segs) {
      if (i < pos + s.text.length) return s.style;
      pos += s.text.length;
    }
    return undefined;
  };
  for (const i of [0, 1, 3, 4, 7]) assert.equal(styleAt(i), "syntax", `index ${i}`);
  assert.equal(styleAt(2), "dim");
  assert.equal(styleAt(6), "dim");
});

test("repetition heat grows with frequency", () => {
  assert.equal(heatLevel(1, 10), 0);
  assert.ok(heatLevel(10, 10) > heatLevel(2, 10));
  const text = `${"status ".repeat(10)}owner owner`;
  const segs = segmentsFor("repetition", text, analyze(text, T));
  const statusCls = segs.find((s) => s.text === "status")?.style;
  const ownerCls = segs.find((s) => s.text === "owner")?.style;
  assert.equal(statusCls, "heat-4");
  assert.equal(ownerCls, "heat-1");
});

test("tokens lens alternates shades between adjacent pieces", () => {
  const text = "hello world";
  const segs = segmentsFor("tokens", text, analyze(text, T));
  assert.deepEqual(
    segs.map((s) => [s.text, s.style]),
    [
      ["hello", "token-a"],
      [" world", "token-b"],
    ],
  );
});
