import { test } from "node:test";
import assert from "node:assert/strict";
import { FolderPageFiles } from "../store/folder.ts";
import { parseFilePath } from "../store/refs.ts";
import { asDirectoryHandle, FakeDirectoryHandle } from "../store/testing/fake-opfs.ts";
import { isStoreError } from "../store/types.ts";
import { layoutRows } from "../text.ts";
import { matchLines, sheetFiles, toFile, toSheet } from "./faithful.ts";

/** Seeded PRNG (mulberry32), so failures reproduce. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PIECES = ["a", "b", "Agent", " ", "  ", "\t", "\t\t", "—", "é", "漢", "#", "-", "`", "x".repeat(90)];
const ENDINGS = ["\n", "\n", "\n", "\r\n", "\r\n", "\r"];

function randomFile(r: () => number): string {
  if (r() < 0.05) return r() < 0.5 ? "" : "﻿";
  const count = Math.floor(r() * 40);
  let out = r() < 0.2 ? "﻿" : "";
  for (let i = 0; i < count; i++) {
    const pieces = Math.floor(r() * 6);
    for (let p = 0; p < pieces; p++) out += PIECES[Math.floor(r() * PIECES.length)];
    const last = i === count - 1;
    if (!last || r() < 0.7) out += ENDINGS[Math.floor(r() * ENDINGS.length)];
  }
  return out;
}

/** Split raw text into [content, ending] pairs, the way the mapper reads it. */
function rawLines(raw: string): [string, string][] {
  const body = raw.startsWith("﻿") ? raw.slice(1) : raw;
  const out: [string, string][] = [];
  const re = /([^\r\n]*)(\r\n|\n|\r|$)/g;
  for (let m = re.exec(body); m && m[0] !== ""; m = re.exec(body)) {
    out.push([m[1], m[2]]);
  }
  return out;
}

test("an unedited sheet maps back to the exact file, across 2,000 generated files", () => {
  const r = rng(20261124);
  for (let n = 0; n < 2000; n++) {
    const raw = randomFile(r);
    const sheet = toSheet(raw);
    assert.ok(!/[\t\r﻿]/.test(sheet), `sheet holds a tab, CR, or BOM: ${JSON.stringify(raw)}`);
    assert.equal(toFile(raw, sheet), raw, JSON.stringify(raw));
  }
});

test("replacing one sheet line changes exactly that line", () => {
  const r = rng(7);
  let checked = 0;
  for (let n = 0; n < 2000; n++) {
    const raw = randomFile(r);
    const lines = toSheet(raw).split("\n");
    if (toSheet(raw) === "") continue;
    const j = Math.floor(r() * lines.length);
    lines[j] = `EDITED ${n}`;
    const out = toFile(raw, lines.join("\n"));
    const before = rawLines(raw);
    const after = rawLines(out);
    assert.equal(after.length, before.length, JSON.stringify(raw));
    for (let i = 0; i < before.length; i++) {
      if (i === j) {
        assert.equal(after[i][0], `EDITED ${n}`);
      } else {
        assert.equal(after[i][0], before[i][0], `line ${i} of ${JSON.stringify(raw)}`);
        // Unedited lines keep their own ending, except the line before an edited last line.
        if (i !== before.length - 1) assert.equal(after[i][1], before[i][1], `ending ${i} of ${JSON.stringify(raw)}`);
      }
    }
    assert.equal(out.startsWith("﻿"), raw.startsWith("﻿"));
    assert.equal(/(\r\n|\n|\r)$/.test(out), /(\r\n|\n|\r)$/.test(raw.replace(/^﻿/, "")));
    checked++;
  }
  assert.ok(checked > 1500);
});

test("the spec's CRLF case: one edited line in a 120-line file with a BOM and tabs", () => {
  const lines: string[] = [];
  for (let i = 1; i <= 120; i++) lines.push(i >= 10 && i <= 20 ? `\tindented ${i}` : `line ${i}`);
  const raw = `﻿${lines.join("\r\n")}\r\n`;
  const sheet = toSheet(raw).split("\n");
  assert.equal(sheet[9], "  indented 10");
  sheet[49] = "line 50, edited";
  const out = toFile(raw, sheet.join("\n"));
  const before = raw.split("\r\n");
  const after = out.split("\r\n");
  assert.equal(after.length, before.length);
  const differing = before.map((l, i) => (l === after[i] ? -1 : i)).filter((i) => i >= 0);
  assert.deepEqual(differing, [49]);
  assert.equal(after[49], "line 50, edited");
  assert.ok(out.startsWith("﻿"));
  assert.ok(out.endsWith("\r\n"));
  for (let i = 9; i <= 19; i++) assert.ok(after[i].startsWith("\t"));
});

test("a file longer than a page keeps every row when an early row is edited", () => {
  const lines = Array.from({ length: 140 }, (_, i) => `row ${i + 1}`);
  const raw = `${lines.join("\n")}\n`;
  assert.equal(layoutRows(toSheet(raw), 80).length, 140);
  const sheet = toSheet(raw).split("\n");
  sheet[2] = "row 3, edited";
  const out = toFile(raw, sheet.join("\n"));
  const outLines = out.split("\n");
  assert.equal(outLines.length, 141);
  assert.equal(outLines[2], "row 3, edited");
  assert.deepEqual(outLines.slice(60, 140), lines.slice(60, 140));
});

test("inserted lines use the file's main ending; an empty file gains a final LF", () => {
  assert.equal(toFile("a\r\nb\r\n", "a\nnew\nb"), "a\r\nnew\r\nb\r\n");
  assert.equal(toFile("a\nb\r\nc\n", "a\nb\nc\nd"), "a\nb\r\nc\nd\n");
  assert.equal(toFile("", "Hello"), "Hello\n");
  assert.equal(toFile("", ""), "");
  assert.equal(toFile("no newline", "no newline\nmore"), "no newline\nmore");
  assert.equal(toFile("﻿x", "y"), "﻿y");
});

test("deleting lines keeps the untouched lines' bytes; a moved line is a new line", () => {
  const raw = "\tone\r\ntwo\r\n\tthree\r\nfour\r\n";
  assert.equal(toFile(raw, "  one\n  three\nfour"), "\tone\r\n\tthree\r\nfour\r\n");
  // Only one of two swapped lines can match; the other is written as the sheet shows it.
  assert.equal(toFile(raw, "four\n  one"), "four\r\n  one\r\n");
});

test("line matching is a common subsequence, even past the edit-distance cap", () => {
  const a = Array.from({ length: 3000 }, (_, i) => `a${i}`);
  const b = Array.from({ length: 3000 }, (_, i) => (i % 2 === 0 ? `a${i}` : `b${i}`));
  const pairs = matchLines(a, b);
  let lastA = -1;
  let lastB = -1;
  for (const [i, j] of pairs) {
    assert.equal(a[i], b[j]);
    assert.ok(i > lastA && j > lastB);
    lastA = i;
    lastB = j;
  }
  assert.equal(pairs.length, 1500);
});

function folder() {
  const root = new FakeDirectoryHandle("repo");
  return { root, files: sheetFiles(new FolderPageFiles(asDirectoryHandle(root), { id: "t", locks: null })) };
}

test("the adapter reads sheet text and writes the file faithfully", async () => {
  const { root, files } = folder();
  const path = parseFilePath("AGENTS.md");
  root.put("AGENTS.md", "# Agents\r\n\tRule one\r\n");
  const page = await files.read(path);
  assert.equal(page.text, "# Agents\n  Rule one");
  const saved = await files.write(path, "# Agents\n  Rule one\nRule two", page.revision);
  assert.equal(root.fileAt("AGENTS.md")!.text, "# Agents\r\n\tRule one\r\nRule two\r\n");
  assert.equal((await files.read(path)).revision, saved.revision);
});

test("the adapter never rewrites a file whose text wasn't edited", async () => {
  const { root, files } = folder();
  const path = parseFilePath("CLAUDE.md");
  const handle = root.put("CLAUDE.md", "\tTabs\r\n", 42);
  const page = await files.read(path);
  await files.write(path, page.text, page.revision);
  assert.equal(handle.writes, 0);
  assert.equal((await handle.getFile()).lastModified, 42);
});

test("the adapter rejects a stale revision and leaves the file unchanged", async () => {
  const { root, files } = folder();
  const path = parseFilePath("AGENTS.md");
  root.put("AGENTS.md", "v1\n");
  const page = await files.read(path);
  root.fileAt("AGENTS.md")!.setContent("checked out\n");
  await assert.rejects(files.write(path, "mine", page.revision), (e: unknown) => isStoreError(e, "conflict"));
  assert.equal(root.fileAt("AGENTS.md")!.text, "checked out\n");
});
