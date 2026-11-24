import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePageName } from "./names.ts";
import { baseName, decodeRef, encodeRef, fileRef, libraryRef, parseFilePath, sameRef } from "./refs.ts";
import { isStoreError } from "./types.ts";
import { copyNameFor, fileCopyName } from "./refs.ts";

test("file paths: valid relative Markdown paths", () => {
  for (const ok of [
    "AGENTS.md",
    ".claude/skills/review/SKILL.md",
    ".cursor/rules/style.mdc",
    "docs/Guide.MD",
    "a b/c:d.md",
  ]) {
    assert.equal(parseFilePath(ok), ok);
  }
  assert.equal(parseFilePath(`${"a/".repeat(254)}x.md`).length, 512);
});

test("file paths: rejected", () => {
  const bad = [
    "",
    "/AGENTS.md",
    "../notes.md",
    "docs/../AGENTS.md",
    "./AGENTS.md",
    "docs//AGENTS.md",
    "docs/",
    "AGENTS.txt",
    ".md",
    ".github/workflows/ci.yml",
    "docs\\AGENTS.md",
    "bell\u0007.md",
    " docs/a.md",
    `${"a/".repeat(254)}xy.md`,
  ];
  for (const input of bad) {
    assert.throws(
      () => parseFilePath(input),
      (e: unknown) => isStoreError(e, "invalid-name"),
      JSON.stringify(input),
    );
  }
});

test("references round-trip through their scalar form", () => {
  const lib = libraryRef(parsePageName("Agent charter"));
  const file = fileRef(parseFilePath(".claude/skills/review/SKILL.md"));
  assert.equal(encodeRef(lib), "Agent charter");
  assert.equal(encodeRef(file), "file:.claude/skills/review/SKILL.md");
  assert.ok(sameRef(decodeRef(encodeRef(lib)), lib));
  assert.ok(sameRef(decodeRef(encodeRef(file)), file));
  assert.equal(encodeRef(null), "");
  assert.equal(decodeRef(""), null);
  assert.ok(!sameRef(lib, file));
});

test("existing remembered values decode as library pages", () => {
  // Values written before folders existed are bare page names.
  assert.deepEqual(decodeRef("Welcome"), { kind: "library", name: "Welcome" });
  assert.deepEqual(decodeRef("INCIDENT INC-2291 · Checkout latency"), {
    kind: "library",
    name: "INCIDENT INC-2291 · Checkout latency",
  });
  // Unparseable values are dropped rather than guessed at.
  assert.equal(decodeRef("file:../x.md"), null);
  assert.equal(decodeRef(".hidden"), null);
});

test("base names", () => {
  assert.equal(baseName("AGENTS.md"), "AGENTS.md");
  assert.equal(baseName(".claude/skills/review/SKILL.md"), "SKILL.md");
});

test("copy names for files: › for /, no leading period, trailing segments kept", () => {
  assert.equal(fileCopyName("AGENTS.md", " (fit)"), "AGENTS.md (fit)");
  assert.equal(fileCopyName(".claude/skills/review/SKILL.md", " (fit)"), "claude › skills › review › SKILL.md (fit)");
  const long = `${"very-long-folder-name/".repeat(6)}SKILL.md`;
  const name = fileCopyName(long, " (conflict 2026-11-24 10.05)");
  assert.ok(name.length <= 80, name);
  assert.ok(name.startsWith("… › "), name);
  assert.ok(name.endsWith("SKILL.md (conflict 2026-11-24 10.05)"), name);
  assert.equal(copyNameFor(libraryRef(parsePageName("Brief")), " (fit)"), "Brief (fit)");
  assert.equal(copyNameFor(fileRef(parseFilePath("docs/AGENTS.md")), " copy"), "docs › AGENTS.md copy");
});
