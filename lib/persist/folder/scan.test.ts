import { test } from "node:test";
import assert from "node:assert/strict";
import { fileGroup, isContextFile, isLetterPath, PAGE_ROWS, scanFolder, stackOfPath } from "./scan.ts";
import { browserFixture, nodeFixture, type FolderFixture } from "./testing/fixtures.ts";

const lines = (n: number) =>
  `${Array.from({ length: n }, (_, i) => `Line ${i + 1} of the agent context.`).join("\n")}\n`;

test("context file patterns", () => {
  for (const path of [
    "AGENTS.md",
    "packages/api/AGENTS.md",
    "CLAUDE.md",
    "CLAUDE.local.md",
    "GEMINI.md",
    ".claude/skills/review/SKILL.md",
    ".agents/skills/x/SKILL.md",
    ".claude/agents/reviewer.md",
    ".claude/commands/ship.md",
    ".claude/commands/git/commit.md",
    ".github/copilot-instructions.md",
    ".github/instructions/api.instructions.md",
    ".cursor/rules/style.mdc",
  ]) {
    assert.ok(isContextFile(path), path);
  }
  for (const path of [
    "README.md",
    "docs/guide.md",
    ".github/PULL_REQUEST_TEMPLATE.md",
    ".claude/notes.md",
    "style.mdc",
  ]) {
    assert.ok(!isContextFile(path), path);
  }
});

test("letters: .md files directly in .agents/letters/, grouped before context files", () => {
  assert.equal(fileGroup(".agents/letters/2026-11-25-0930-auth.md"), "letter");
  assert.equal(fileGroup(".agents/letters/AGENTS.md"), "letter", "a letter is never a context file");
  assert.equal(fileGroup(".agents/letters/old/x.md"), "other");
  assert.equal(fileGroup("AGENTS.md"), "context");
  assert.equal(fileGroup("docs/letter.md"), "other");
  assert.ok(!isLetterPath(".agents/letters/x.mdc"));
});

/** The scan tests, on one adapter. */
function suite<H>(label: string, makeFixture: () => Promise<FolderFixture<H>>) {
  const scan = async (files: Record<string, string | Uint8Array>, options?: { limit?: number }) => {
    const fixture = await makeFixture();
    try {
      const folder = await fixture.folder("a4", files);
      return await scanFolder(fixture.source.open(folder.handle), options);
    } finally {
      await fixture.dispose();
    }
  };

  test(`${label}: letters are measured and listed first, not under Other Markdown`, async () => {
    const result = await scan({
      ".agents/letters/2026-11-25-0930-auth.md": lines(63),
      "AGENTS.md": lines(5),
      "docs/guide.md": lines(3),
    });
    assert.deepEqual(
      result.files.map((f) => [f.path, f.group]),
      [
        [".agents/letters/2026-11-25-0930-auth.md", "letter"],
        ["AGENTS.md", "context"],
        ["docs/guide.md", "other"],
      ],
    );
    assert.equal(result.files[0]?.rows, 63);
  });

  test(`${label}: a context file over one page reports its rows`, async () => {
    const result = await scan({
      "AGENTS.md": lines(74),
      ".claude/skills/review/SKILL.md": "---\nname: review\n---\n\nReview the diff.\n",
      "docs/guide.md": lines(3),
    });
    assert.equal(result.partial, false);
    const agents = result.files.find((f) => f.path === "AGENTS.md");
    assert.equal(agents?.group, "context");
    assert.equal(agents?.rows, 74);
    assert.equal((agents?.rows ?? 0) - PAGE_ROWS, 14);
    const skill = result.files.find((f) => f.path === ".claude/skills/review/SKILL.md");
    assert.equal(skill?.group, "context");
    assert.equal(skill?.rows, 5);
    const guide = result.files.find((f) => f.path === "docs/guide.md");
    assert.equal(guide?.group, "other");
    assert.equal(guide?.rows, null);
    // Context files first, then other Markdown, each by path.
    assert.deepEqual(
      result.files.map((f) => f.path),
      [".claude/skills/review/SKILL.md", "AGENTS.md", "docs/guide.md"],
    );
  });

  test(`${label}: dependencies are skipped`, async () => {
    const result = await scan({
      "docs/guide.md": "x",
      "node_modules/pkg/README.md": "x",
      "node_modules/pkg/AGENTS.md": "x",
    });
    assert.deepEqual(
      result.files.map((f) => f.path),
      ["docs/guide.md"],
    );
  });

  test(`${label}: too large and not UTF-8 files are listed with the reason`, async () => {
    const result = await scan({ "CHANGELOG.md": "x".repeat(2_000_000), "CLAUDE.md": new Uint8Array([0x61, 0xff]) });
    assert.equal(result.files.find((f) => f.path === "CHANGELOG.md")?.unreadable, "too-large");
    assert.equal(result.files.find((f) => f.path === "CLAUDE.md")?.unreadable, "not-utf8");
  });

  test(`${label}: the scan stops at the entry limit and says the list is partial`, async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 50; i++) files[`notes/${String(i).padStart(2, "0")}.md`] = "x";
    const result = await scan(files, { limit: 25 });
    assert.equal(result.partial, true);
    assert.equal(result.files.length, 24);
  });
}

suite("browser", async () => browserFixture());
suite("node", nodeFixture);

test("stacks: .md files directly in a named stack folder are its pages, grouped after letters", () => {
  assert.equal(stackOfPath(".agents/stacks/auth/01-charter.md"), "auth");
  assert.equal(stackOfPath(".agents/stacks/auth/02-service.a5.md"), "auth");
  assert.equal(fileGroup(".agents/stacks/auth/01-charter.md"), "stack");
  for (const path of [
    ".agents/stacks/auth/old/x.md",
    ".agents/stacks/Auth Notes/01.md",
    ".agents/stacks/auth/stack.json",
    ".agents/stacks/01.md",
    ".agents/stacks/-auth/01.md",
    `.agents/stacks/${"a".repeat(41)}/01.md`,
  ]) {
    assert.equal(stackOfPath(path), null, path);
  }
  assert.equal(fileGroup(".agents/stacks/auth/old/x.md"), "other");
  // A stack page named like a context file is still a stack page: a sheet lies on one stack.
  assert.equal(fileGroup(".agents/stacks/auth/CLAUDE.md"), "stack");
});

test("stack pages are listed in their own group, with each page's size and rows out of its size's", async () => {
  const fixture = await nodeFixture();
  try {
    const folder = await fixture.folder("repo", {
      ".agents/stacks/auth/01-charter.md": "Charter.\n",
      ".agents/stacks/auth/02-service.a5.md": Array.from({ length: 45 }, (_, i) => `Row ${i}.`).join("\n"),
      "docs/guide.md": "Guide.\n",
    });
    const scan = await scanFolder(fixture.source.open(folder.handle));
    const byPath = new Map<string, (typeof scan.files)[number]>(scan.files.map((f) => [f.path, f]));
    assert.equal(byPath.get(".agents/stacks/auth/01-charter.md")?.group, "stack");
    const card = byPath.get(".agents/stacks/auth/02-service.a5.md");
    assert.deepEqual([card?.group, card?.paper, card?.rows, card?.pageRows], ["stack", "a5", 45, 42]);
    assert.equal(byPath.get("docs/guide.md")?.group, "other");
  } finally {
    await fixture.dispose();
  }
});
