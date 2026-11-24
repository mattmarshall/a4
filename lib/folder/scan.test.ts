import { test } from "node:test";
import assert from "node:assert/strict";
import { isContextFile, PAGE_ROWS, scanFolder } from "./scan.ts";
import { browserFixture, nodeFixture, type FolderFixture } from "./testing/fixtures.ts";

const lines = (n: number) =>
  Array.from({ length: n }, (_, i) => `Line ${i + 1} of the agent context.`).join("\n") + "\n";

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
