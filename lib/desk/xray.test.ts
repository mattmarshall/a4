import { test } from "node:test";
import assert from "node:assert/strict";
import { toJsonString } from "@bufbuild/protobuf";
import {
  ContextXraySchema,
  DESCRIPTION_LIMIT,
  frontMatter,
  importsOf,
  indexEntry,
  indexText,
  memorySlice,
  ruleLoadsAtStart,
  Unreadable,
  xrayReport,
  XraySourceKind,
} from "./xray.ts";

test("imports: @paths in prose, with trailing punctuation dropped and escaped spaces kept", () => {
  assert.deepEqual(importsOf("See @docs/agents.md."), ["docs/agents.md"]);
  assert.deepEqual(importsOf("@AGENTS.md\nAnd @~/.claude/notes.md, then (@a.md)"), ["AGENTS.md", "~/.claude/notes.md"]);
  assert.deepEqual(importsOf("Read @my\\ notes.md first"), ["my notes.md"]);
});

test("imports: not in code spans, fenced blocks, or email addresses", () => {
  assert.deepEqual(importsOf("Write `@docs/example.md` literally."), []);
  assert.deepEqual(importsOf("```\n@docs/in-fence.md\n```\n~~~md\n@also.md\n~~~\n@after.md"), ["after.md"]);
  assert.deepEqual(importsOf("Mail ana@example.com about it."), []);
});

test("front matter: keys, quoted values, block scalars, and lists; none or unreadable is null", () => {
  const fields = frontMatter(
    '---\nname: review\ndescription: "Review a diff"\nwhen_to_use: >\n  when asked\n  to review\npaths:\n  - "src/api/**"\n---\nBody',
  );
  assert.equal(fields?.get("name"), "review");
  assert.equal(fields?.get("description"), "Review a diff");
  assert.equal(fields?.get("when_to_use"), "when asked to review");
  assert.equal(fields?.get("paths"), '"src/api/**"');
  assert.equal(frontMatter("No front matter."), null);
  assert.equal(frontMatter("---\nname: x\nthis is not yaml\n---\n"), null);
});

test("a rule with paths loads on demand; one without, or with front matter that can't be read, loads at start", () => {
  assert.equal(ruleLoadsAtStart('---\npaths: ["src/api/**"]\n---\nUse the API client.'), false);
  assert.equal(ruleLoadsAtStart("---\npaths:\n  - src/**\n---\nx"), false);
  assert.equal(ruleLoadsAtStart("Plain rule, no front matter."), true);
  assert.equal(ruleLoadsAtStart("---\npaths: [src\nnot yaml at all\n---\nx"), true);
});

test("index entries: a skill that turns model invocation off isn't listed, and descriptions are cut at 1,536", () => {
  assert.equal(indexEntry("---\nname: x\ndisable-model-invocation: true\n---\n", "x"), null);
  const long = indexEntry(`---\ndescription: ${"d".repeat(2000)}\n---\n`, "fallback");
  assert.equal(long?.name, "fallback");
  assert.equal(long?.description.length, DESCRIPTION_LIMIT);
  const both = indexEntry("---\nname: review\ndescription: Review a diff.\nwhen_to_use: When asked.\n---\n", "r");
  assert.equal(both?.description, "Review a diff. When asked.");
  assert.equal(
    indexText([both ?? { name: "", description: "" }, { name: "bare", description: "" }]),
    "review: Review a diff. When asked.\nbare",
  );
});

test("auto memory: the first 200 lines, at most 25,600 bytes, cut on a character", () => {
  const lines = Array.from({ length: 260 }, (_, i) => `Line ${i + 1}`).join("\n");
  assert.equal(memorySlice(lines).split("\n").length, 200);
  const wide = Array.from({ length: 100 }, () => "é".repeat(200)).join("\n");
  const slice = memorySlice(wide);
  assert.ok(new TextEncoder().encode(slice).length <= 25_600);
  assert.ok(slice.isWellFormed() && !slice.includes("�"), "cut on a character boundary");
});

test("the report: pages are rows over 60, and the budget compares the total", () => {
  const rows = (n: number) => Array.from({ length: n }, (_, i) => `Line ${i + 1} of the context.`).join("\n");
  const report = xrayReport(
    [
      { kind: XraySourceKind.USER, path: "~/.claude/CLAUDE.md", text: rows(30) },
      { kind: XraySourceKind.PROJECT, path: "CLAUDE.md", text: `${rows(90)}\ntoken: sk-test-123` },
      { kind: XraySourceKind.IMPORT, path: "docs/gone.md", importedBy: "CLAUDE.md", text: null, missing: true },
      { kind: XraySourceKind.RULE, path: ".claude/rules/big.md", text: null, unreadable: Unreadable.NOT_UTF8 },
    ],
    { folder: ".", budget: 1.5 },
  );
  assert.deepEqual(
    report.sources.map((s) => s.pages),
    [0.5, 91 / 60, 0, 0],
  );
  assert.equal(report.totalPages, 121 / 60);
  assert.equal(report.overBudget, true);
  assert.equal(report.sources[2]?.missing, true);
  assert.equal(report.agent, "claude-code");
  assert.ok(report.notCounted.length >= 5);
  assert.ok(!toJsonString(ContextXraySchema, report).includes("sk-test-123"), "no text in the record");
});
