import { test } from "node:test";
import assert from "node:assert/strict";
import { FolderPageFiles, MAX_FILE_BYTES, walkFolder } from "./folder.ts";
import { parseFilePath, type FilePath } from "./refs.ts";
import { revisionOf } from "./revision.ts";
import { pageFilesContract } from "./testing/contract.ts";
import { asDirectoryHandle, FakeDirectoryHandle } from "./testing/fake-opfs.ts";
import { isStoreError, type FileUnreadableError, type PageStoreErrorCode } from "./types.ts";

const p = (s: string) => parseFilePath(s);

function folder(root = new FakeDirectoryHandle("repo")) {
  return { root, store: new FolderPageFiles(asDirectoryHandle(root), { id: "test", locks: null }) };
}

async function rejectsWith(promise: Promise<unknown>, code: PageStoreErrorCode) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(isStoreError(error, code), `expected ${code}, got ${String(error)}`);
    return true;
  });
}

// The folder backend passes the core contract unchanged.
pageFilesContract("folder (in-memory fake)", async () => folder().store, (stem) => p(`${stem}.md`));

test("nested files are read and written by relative path", async () => {
  const { root, store } = folder();
  await store.create(p(".claude/skills/review/SKILL.md"), "# Review\n");
  assert.equal(root.fileAt(".claude/skills/review/SKILL.md")?.text, "# Review\n");
  const page = await store.read(p(".claude/skills/review/SKILL.md"));
  assert.equal(page.text, "# Review\n");
});

test("a byte-order mark round-trips as U+FEFF", async () => {
  const { root, store } = folder();
  root.put("AGENTS.md", new Uint8Array([0xef, 0xbb, 0xbf, 0x68, 0x69, 0x0d, 0x0a]));
  const page = await store.read(p("AGENTS.md"));
  assert.equal(page.text, "﻿hi\r\n");
  await store.write(p("AGENTS.md"), page.text + "more\r\n", page.revision);
  const bytes = new Uint8Array(await (await root.fileAt("AGENTS.md")!.getFile()).arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.equal(root.fileAt("AGENTS.md")!.text, "﻿hi\r\nmore\r\n");
});

test("invalid UTF-8 and very large files are unreadable, with the reason", async () => {
  const { root, store } = folder();
  root.put("notes.md", new Uint8Array([0x61, 0xff, 0x62]));
  root.put("CHANGELOG.md", "x".repeat(MAX_FILE_BYTES + 1));
  root.put("ok.md", "x".repeat(MAX_FILE_BYTES));
  await assert.rejects(store.read(p("notes.md")), (e: unknown) => isStoreError(e, "unreadable") && (e as FileUnreadableError).reason === "not-utf8");
  await assert.rejects(store.read(p("CHANGELOG.md")), (e: unknown) => isStoreError(e, "unreadable") && (e as FileUnreadableError).reason === "too-large");
  assert.equal((await store.read(p("ok.md"))).size, MAX_FILE_BYTES);
});

test("only .md and .mdc paths inside the folder are accepted", async () => {
  const { root, store } = folder();
  await rejectsWith(store.create(".github/workflows/ci.yml" as FilePath, "on: push"), "invalid-name");
  await rejectsWith(store.write("../outside.md" as FilePath, "x"), "invalid-name");
  assert.equal(root.children.size, 0);
  await store.create(p(".cursor/rules/style.mdc"), "rule");
  assert.equal(root.fileAt(".cursor/rules/style.mdc")?.text, "rule");
});

test("a file changed by another program is a conflict, and the file keeps its text", async () => {
  const { root, store } = folder();
  const created = await store.create(p("AGENTS.md"), "v1");
  root.fileAt("AGENTS.md")!.setContent("checked out");
  await rejectsWith(store.write(p("AGENTS.md"), "mine", created.revision), "conflict");
  assert.equal(root.fileAt("AGENTS.md")!.text, "checked out");
  // A file that turned into non-UTF-8 bytes also conflicts.
  root.fileAt("AGENTS.md")!.setContent(new Uint8Array([0xff]));
  await rejectsWith(store.write(p("AGENTS.md"), "mine", revisionOf("checked out")), "conflict");
});

test("a file deleted by another program is not found, and isn't recreated", async () => {
  const { root, store } = folder();
  const created = await store.create(p("AGENTS.md"), "v1");
  root.remove("AGENTS.md");
  await rejectsWith(store.write(p("AGENTS.md"), "mine", created.revision), "not-found");
  assert.equal(root.fileAt("AGENTS.md"), undefined);
});

test("the walk skips dependency, build, and hidden folders but keeps agent folders", async () => {
  const root = new FakeDirectoryHandle("repo");
  for (const path of [
    "AGENTS.md",
    "docs/guide.md",
    ".claude/agents/reviewer.md",
    ".github/copilot-instructions.md",
    ".cursor/rules/style.mdc",
    ".agents/skills/x/SKILL.md",
    "node_modules/pkg/README.md",
    ".git/info.md",
    "dist/out.md",
    ".idea/notes.md",
    "src/main.ts",
  ]) {
    root.put(path, "x");
  }
  const { files, partial } = await walkFolder(asDirectoryHandle(root));
  assert.equal(partial, false);
  assert.deepEqual(
    files.map((f) => f.path).sort(),
    [".agents/skills/x/SKILL.md", ".claude/agents/reviewer.md", ".cursor/rules/style.mdc", ".github/copilot-instructions.md", "AGENTS.md", "docs/guide.md"],
  );
});

test("the walk stops at the entry limit and reports a partial list", async () => {
  const root = new FakeDirectoryHandle("repo");
  for (let i = 0; i < 30; i++) root.put(`notes/${i}.md`, "x");
  const result = await walkFolder(asDirectoryHandle(root), 20);
  assert.equal(result.partial, true);
  assert.equal(result.visited, 20);
  assert.equal(result.files.length, 19); // the "notes" folder counts as one entry
});
