import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { openZip, ZipError, type ZipErrorCode } from "./unzip.ts";
import { createZip } from "./zip.ts";

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
const text = async (bytes: Promise<Uint8Array>) => new TextDecoder().decode(await bytes);

function isZipError(code: ZipErrorCode) {
  return (error: unknown) => {
    assert.ok(error instanceof ZipError, `expected ZipError, got ${String(error)}`);
    assert.equal(error.code, code);
    return true;
  };
}

/** Offsets of each central directory record. */
function centralOffsets(bytes: Uint8Array): number[] {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = bytes.length - 22;
  let at = v.getUint32(eocd + 16, true);
  const out: number[] = [];
  for (let i = 0; i < v.getUint16(eocd + 10, true); i++) {
    out.push(at);
    at += 46 + v.getUint16(at + 28, true) + v.getUint16(at + 30, true) + v.getUint16(at + 32, true);
  }
  return out;
}

test("reads A4's own archives", async () => {
  const bytes = await createZip([
    { name: "a4-pages/Brief.md", data: "brief ".repeat(50) },
    { name: "a4-pages/Café brief · 漢字.md", data: "unicode" },
  ]);
  const entries = openZip(bytes);
  assert.deepEqual(
    entries.map((e) => e.name),
    ["a4-pages/Brief.md", "a4-pages/Café brief · 漢字.md"],
  );
  assert.equal(await text(entries[0].read()), "brief ".repeat(50));
  assert.equal(await text(entries[1].read()), "unicode");
});

test("reads Info-ZIP archives with data descriptors and unflagged UTF-8 names", async () => {
  const entries = openZip(fixture("infozip-descriptors.zip"));
  const byName = new Map(entries.map((e) => [e.name, e]));
  assert.ok(byName.get("pages/")?.isDirectory);
  assert.equal(await text(byName.get("pages/Brief.md")!.read()), "SITUATION BRIEF\r\n\r\nPurpose:\tbrief the agent.\r\n");
  assert.equal(await text(byName.get("pages/Café brief · 漢字.md")!.read()), "Café brief · 漢字\n");
  assert.equal(await text(byName.get("pages/notes/handoff.txt")!.read()), "Handoff notes, plain text.\n");
});

test("reads macOS Finder (ditto) archives, including __MACOSX entries", async () => {
  const entries = openZip(fixture("finder-ditto.zip"));
  const names = entries.map((e) => e.name);
  assert.ok(names.includes("__MACOSX/pages/._Brief.md"));
  assert.ok(names.includes("pages/Café brief · 漢字.md"));
  for (const e of entries.filter((x) => !x.isDirectory)) await e.read(); // every CRC verifies
});

test("reads Python zipfile archives (stored, deflated, flagged UTF-8)", async () => {
  const entries = openZip(fixture("python-zipfile.zip"));
  assert.deepEqual(
    entries.map((e) => [e.name, e.method]),
    [
      ["Brief.md", 0],
      ["deflated/Charter.md", 8],
      ["Café brief · 漢字.md", 8],
    ],
  );
  assert.equal(await text(entries[1].read()), "AGENT CHARTER\n".repeat(30));
});

test("legacy names that are not UTF-8 decode as Windows-1252", async () => {
  const bytes = await createZip([{ name: "Caf_.md", data: "x" }]);
  // Rewrite '_' as 0xE9 (é in Windows-1252) and clear the UTF-8 flag, in both headers.
  const v = new DataView(bytes.buffer);
  const central = centralOffsets(bytes)[0];
  v.setUint16(6, 0, true);
  v.setUint16(central + 8, 0, true);
  bytes[30 + 3] = 0xe9;
  bytes[central + 46 + 3] = 0xe9;
  assert.equal(openZip(bytes)[0].name, "Café.md");
});

test("guards: not a zip", () => {
  assert.throws(() => openZip(new TextEncoder().encode("definitely not a zip archive at all")), isZipError("not-zip"));
  assert.throws(() => openZip(new Uint8Array(4)), isZipError("not-zip"));
});

test("guards: Zip64 markers are rejected", async () => {
  const bytes = await createZip([{ name: "a.md", data: "a" }]);
  new DataView(bytes.buffer).setUint16(bytes.length - 22 + 10, 0xffff, true);
  assert.throws(() => openZip(bytes), isZipError("zip64"));
});

test("guards: entry count and declared size limits apply before inflating", async () => {
  const bytes = await createZip([
    { name: "a.md", data: "a".repeat(1000) },
    { name: "b.md", data: "b".repeat(1000) },
    { name: "c.md", data: "c" },
  ]);
  assert.throws(() => openZip(bytes, { maxEntries: 2, maxTotalBytes: 1e9 }), isZipError("too-many-entries"));
  assert.throws(() => openZip(bytes, { maxEntries: 10, maxTotalBytes: 1500 }), isZipError("too-large"));
});

test("guards: inflating past the declared size stops (decompression bomb)", async () => {
  const bytes = await createZip([{ name: "bomb.md", data: "a".repeat(100_000) }]);
  const v = new DataView(bytes.buffer);
  v.setUint32(centralOffsets(bytes)[0] + 24, 10, true); // lie: declare 10 bytes
  await assert.rejects(openZip(bytes)[0].read(), isZipError("corrupt"));
});

test("guards: checksum mismatches are detected", async () => {
  const bytes = await createZip([{ name: "a.md", data: "hello" }], { compress: false });
  const v = new DataView(bytes.buffer);
  const at = centralOffsets(bytes)[0] + 16;
  v.setUint32(at, v.getUint32(at, true) ^ 1, true);
  await assert.rejects(openZip(bytes)[0].read(), isZipError("checksum"));
});

test("guards: encrypted entries are not read", async () => {
  const bytes = await createZip([{ name: "secret.md", data: "x" }]);
  const v = new DataView(bytes.buffer);
  const at = centralOffsets(bytes)[0] + 8;
  v.setUint16(at, v.getUint16(at, true) | 1, true);
  const entry = openZip(bytes)[0];
  assert.equal(entry.encrypted, true);
  await assert.rejects(entry.read(), isZipError("encrypted"));
});
