import { test } from "node:test";
import assert from "node:assert/strict";
import { asDirectoryHandle, FakeDirectoryHandle } from "../store/testing/fake-opfs.ts";
import { isContextFile, PAGE_ROWS, scanFolder } from "./scan.ts";

const lines = (n: number) => Array.from({ length: n }, (_, i) => `Line ${i + 1} of the agent context.`).join("\n") + "\n";

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
  for (const path of ["README.md", "docs/guide.md", ".github/PULL_REQUEST_TEMPLATE.md", ".claude/notes.md", "style.mdc"]) {
    assert.ok(!isContextFile(path), path);
  }
});

test("a context file over one page reports its rows", async () => {
  const root = new FakeDirectoryHandle("a4");
  root.put("AGENTS.md", lines(74));
  root.put(".claude/skills/review/SKILL.md", "---\nname: review\n---\n\nReview the diff.\n");
  root.put("docs/guide.md", lines(3));
  const scan = await scanFolder(asDirectoryHandle(root));
  assert.equal(scan.partial, false);
  const agents = scan.files.find((f) => f.path === "AGENTS.md")!;
  assert.equal(agents.group, "context");
  assert.equal(agents.rows, 74);
  assert.equal(agents.rows! - PAGE_ROWS, 14);
  const skill = scan.files.find((f) => f.path === ".claude/skills/review/SKILL.md")!;
  assert.equal(skill.group, "context");
  assert.equal(skill.rows, 5);
  const guide = scan.files.find((f) => f.path === "docs/guide.md")!;
  assert.equal(guide.group, "other");
  assert.equal(guide.rows, null);
  // Context files first, then other Markdown, each by path.
  assert.deepEqual(
    scan.files.map((f) => f.path),
    [".claude/skills/review/SKILL.md", "AGENTS.md", "docs/guide.md"],
  );
});

test("dependencies are skipped", async () => {
  const root = new FakeDirectoryHandle("a4");
  root.put("docs/guide.md", "x");
  root.put("node_modules/pkg/README.md", "x");
  root.put("node_modules/pkg/AGENTS.md", "x");
  const scan = await scanFolder(asDirectoryHandle(root));
  assert.deepEqual(
    scan.files.map((f) => f.path),
    ["docs/guide.md"],
  );
});

test("too large and not UTF-8 files are listed with the reason", async () => {
  const root = new FakeDirectoryHandle("a4");
  root.put("CHANGELOG.md", "x".repeat(2_000_000));
  root.put("CLAUDE.md", new Uint8Array([0x61, 0xff]));
  const scan = await scanFolder(asDirectoryHandle(root));
  assert.equal(scan.files.find((f) => f.path === "CHANGELOG.md")!.unreadable, "too-large");
  assert.equal(scan.files.find((f) => f.path === "CLAUDE.md")!.unreadable, "not-utf8");
});

test("the scan stops at the entry limit and says the list is partial", async () => {
  const root = new FakeDirectoryHandle("a4");
  for (let i = 0; i < 50; i++) root.put(`notes/${String(i).padStart(2, "0")}.md`, "x");
  const scan = await scanFolder(asDirectoryHandle(root), { limit: 25 });
  assert.equal(scan.partial, true);
  assert.equal(scan.files.length, 24);
});
