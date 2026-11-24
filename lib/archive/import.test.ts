import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildLibraryArchive } from "./export.ts";
import { describeImport, importZip, MAX_PAGE_BYTES } from "./import.ts";
import { MemoryPageStore } from "../persist/store/key-value.ts";
import { parsePageName } from "../persist/store/names.ts";
import type { PageStore } from "../persist/store/types.ts";
import { ZipError } from "./unzip.ts";
import { createZip } from "./zip.ts";

const n = parsePageName;
const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));

async function pages(store: PageStore): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const p of await store.list()) out[p.name] = (await store.read(p.name)).text;
  return out;
}

test("importing an export into another library recreates every page", async () => {
  const source = new MemoryPageStore();
  await source.create(n("Brief"), "SITUATION BRIEF\n");
  await source.create(n("Charter"), "AGENT CHARTER\n");
  const target = new MemoryPageStore();
  const report = await importZip(target, (await buildLibraryArchive(source)).bytes);
  assert.deepEqual(await pages(target), { Brief: "SITUATION BRIEF\n", Charter: "AGENT CHARTER\n" });
  assert.equal(report.created.length, 2);
  assert.equal(describeImport(report), "Imported 2 pages.");
});

test("re-importing your own export changes nothing", async () => {
  const store = new MemoryPageStore();
  await store.create(n("Brief"), "SITUATION BRIEF\n");
  await store.create(n("Charter"), "AGENT CHARTER\n");
  const report = await importZip(store, (await buildLibraryArchive(store)).bytes);
  assert.equal(report.created.length, 0);
  assert.deepEqual(report.unchanged.map((u) => u.name).sort(), ["Brief", "Charter"]);
  assert.equal(describeImport(report), "Imported 0 pages, 2 unchanged.");
});

test("same name, different text: the existing page is untouched and the import is renamed", async () => {
  const store = new MemoryPageStore();
  await store.create(n("Brief"), "v1");
  const report = await importZip(store, await createZip([{ name: "Brief.md", data: "v2" }]));
  assert.deepEqual(await pages(store), { Brief: "v1", "Brief 2": "v2" });
  assert.deepEqual(report.created, [{ path: "Brief.md", name: "Brief 2", renamedFrom: "Brief" }]);
  assert.equal(describeImport(report), "Imported 1 page (1 renamed).");
});

test("duplicates inside one archive", async () => {
  const store = new MemoryPageStore();
  const report = await importZip(
    store,
    await createZip([
      { name: "a/Brief.md", data: "x" },
      { name: "b/Brief.md", data: "x" },
      { name: "c/Brief.md", data: "y" },
      { name: "d/brief.md", data: "y" },
    ]),
  );
  assert.deepEqual(await pages(store), { Brief: "x", "Brief 2": "y" });
  assert.equal(report.unchanged.length, 2);
});

test("text is normalized like paste: CRLF, tabs, and a BOM", async () => {
  const store = new MemoryPageStore();
  await importZip(store, await createZip([{ name: "notes/handoff.txt", data: "﻿line one\r\n\tindented\rend" }]));
  assert.deepEqual(await pages(store), { handoff: "line one\n  indented\nend" });
});

test("a macOS Finder archive imports pages and skips metadata, hidden, and other files", async () => {
  const store = new MemoryPageStore();
  const report = await importZip(store, fixture("finder-ditto.zip"));
  assert.deepEqual(await pages(store), {
    Brief: "SITUATION BRIEF\n\nPurpose:  brief the agent.\n",
    handoff: "Handoff notes, plain text.\n",
    "Café brief · 漢字": "Café brief · 漢字\n",
  });
  const reasons = report.skipped.map((s) => s.reason).sort();
  assert.deepEqual([...new Set(reasons)].sort(), ["hidden", "macos-metadata", "not-a-page"]);
  assert.equal(report.skipped.filter((s) => s.reason === "hidden").length, 2);
  assert.equal(report.skipped.filter((s) => s.reason === "not-a-page").length, 1);
  assert.match(describeImport(report), /^Imported 3 pages, 10 skipped \(.*macOS metadata.*\)\.$/);
});

test("Info-ZIP and Python archives import too", async () => {
  const a = new MemoryPageStore();
  await importZip(a, fixture("infozip-descriptors.zip"));
  assert.deepEqual(Object.keys(await pages(a)).sort(), ["Brief", "Café brief · 漢字", "handoff"]);
  const b = new MemoryPageStore();
  await importZip(b, fixture("python-zipfile.zip"));
  assert.deepEqual(await pages(b), {
    Brief: "stored text\n",
    Charter: "AGENT CHARTER\n".repeat(30),
    "Café brief · 漢字": "unicode name\n",
  });
});

test("binary, oversized, and damaged entries are skipped", async () => {
  const store = new MemoryPageStore();
  const bytes = await createZip(
    [
      { name: "binary.md", data: new Uint8Array([104, 105, 0, 1]) },
      { name: "huge.md", data: "x".repeat(MAX_PAGE_BYTES + 1) },
      { name: "damaged.md", data: "hello" },
      { name: "fine.md", data: "fine" },
    ],
    { compress: true },
  );
  // Corrupt the CRC of "damaged.md" in the central directory.
  const v = new DataView(bytes.buffer);
  const eocd = bytes.length - 22;
  let at = v.getUint32(eocd + 16, true);
  for (let i = 0; i < 2; i++) at += 46 + v.getUint16(at + 28, true);
  v.setUint32(at + 16, v.getUint32(at + 16, true) ^ 1, true);
  const report = await importZip(store, bytes);
  assert.deepEqual(await pages(store), { fine: "fine" });
  assert.deepEqual(
    report.skipped.map((s) => [s.path, s.reason]),
    [
      ["binary.md", "binary"],
      ["huge.md", "too-large"],
      ["damaged.md", "corrupt"],
    ],
  );
  assert.equal(describeImport(report), "Imported 1 page, 3 skipped (1 binary, 1 over 1 MiB, 1 damaged).");
});

test("an archive-level failure leaves the library unchanged", async () => {
  const store = new MemoryPageStore();
  await store.create(n("Brief"), "v1");
  await assert.rejects(importZip(store, new TextEncoder().encode("not a zip")), (e: unknown) => e instanceof ZipError);
  assert.deepEqual(await pages(store), { Brief: "v1" });
});

test("a file name that sanitizes to a leading period still imports", async () => {
  const store = new MemoryPageStore();
  const zip = await createZip([
    { name: " . .x.md", data: new TextEncoder().encode("odd name\n") },
    { name: "Brief.md", data: new TextEncoder().encode("brief\n") },
  ]);
  const report = await importZip(store, zip);
  assert.equal(report.created.length, 2);
  assert.deepEqual(Object.keys(await pages(store)).sort(), ["Brief", "x"]);
});
