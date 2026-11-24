import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLibraryArchive, localDate } from "./export.ts";
import { MemoryPageStore } from "./store/key-value.ts";
import { parsePageName } from "./store/names.ts";
import { crc32, createZip, dosDateTime } from "./zip.ts";

interface ReadEntry {
  name: string;
  text: string;
  method: number;
  utf8: boolean;
  date: number;
  time: number;
}

/** An independent reader: walks the central directory and inflates each entry. */
async function readZip(bytes: Uint8Array): Promise<ReadEntry[]> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = bytes.length - 22;
  assert.equal(view.getUint32(eocd, true), 0x06054b50, "end of central directory");
  const count = view.getUint16(eocd + 10, true);
  let at = view.getUint32(eocd + 16, true);
  const out: ReadEntry[] = [];
  for (let i = 0; i < count; i++) {
    assert.equal(view.getUint32(at, true), 0x02014b50, "central header");
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const time = view.getUint16(at + 12, true);
    const date = view.getUint16(at + 14, true);
    const crc = view.getUint32(at + 16, true);
    const compSize = view.getUint32(at + 20, true);
    const size = view.getUint32(at + 24, true);
    const nameLen = view.getUint16(at + 28, true);
    const extraLen = view.getUint16(at + 30, true);
    const commentLen = view.getUint16(at + 32, true);
    const localOffset = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLen));

    assert.equal(view.getUint32(localOffset, true), 0x04034b50, "local header");
    const localNameLen = view.getUint16(localOffset + 26, true);
    const localExtraLen = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const body = bytes.subarray(dataStart, dataStart + compSize);
    let raw: Uint8Array;
    if (method === 8) {
      const stream = new Blob([body as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      raw = new Uint8Array(await new Response(stream).arrayBuffer());
    } else {
      assert.equal(method, 0);
      raw = body;
    }
    assert.equal(raw.length, size, `${name} size`);
    assert.equal(crc32(raw), crc, `${name} crc`);
    out.push({ name, text: new TextDecoder().decode(raw), method, utf8: (flags & 0x0800) !== 0, date, time });
    at += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

test("crc32 matches the standard check value", () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
  assert.equal(crc32(new Uint8Array()), 0);
});

test("DOS date and time encode local time at 2 s resolution", () => {
  const { date, time } = dosDateTime(new Date(2026, 10, 23, 16, 5, 31).getTime());
  assert.equal(date, ((2026 - 1980) << 9) | (11 << 5) | 23);
  assert.equal(time, (16 << 11) | (5 << 5) | 15);
  assert.equal(dosDateTime(new Date(1970, 0, 1).getTime()).date, (0 << 9) | (1 << 5) | 1);
});

test("round-trips text exactly, with UTF-8 names, empty files, and both methods", async () => {
  const entries = [
    { name: "pages/Brief.md", data: "Purpose: brief the agent.\n".repeat(40) },
    { name: "pages/Café brief · 漢字.md", data: "Unicode — “quotes”, café, 漢字\n" },
    { name: "pages/Empty.md", data: "" },
    { name: "pages/tiny.md", data: "x" },
  ];
  const entriesOut = await readZip(await createZip(entries));
  assert.deepEqual(
    entriesOut.map((e) => [e.name, e.text]),
    entries.map((e) => [e.name, e.data]),
  );
  assert.ok(entriesOut.every((e) => e.utf8));
  assert.equal(entriesOut[0].method, 8, "repetitive text is deflated");
  assert.equal(entriesOut[3].method, 0, "data that does not shrink is stored");
  const stored = await readZip(await createZip(entries, { compress: false }));
  assert.ok(stored.every((e) => e.method === 0));
  assert.deepEqual(
    stored.map((e) => e.text),
    entries.map((e) => e.data),
  );
});

test("an empty archive is valid", async () => {
  assert.deepEqual(await readZip(await createZip([])), []);
});

test("library export: every page, exact text, dated folder, no trash", async () => {
  const store = new MemoryPageStore({ clock: { now: () => new Date(2026, 10, 23, 9, 30, 0).getTime() } });
  await store.create(parsePageName("Charter"), "AGENT CHARTER\n");
  await store.create(parsePageName("Brief"), "SITUATION BRIEF\n\nPurpose: …\n");
  await store.create(parsePageName("Old"), "trashed");
  await store.trash(parsePageName("Old"));
  const day = new Date(2026, 10, 23);
  const archive = await buildLibraryArchive(store, day);
  assert.equal(archive.fileName, "a4-pages-2026-11-23.zip");
  assert.equal(archive.count, 2);
  const entries = await readZip(archive.bytes);
  assert.deepEqual(
    entries.map((e) => [e.name, e.text]),
    [
      ["a4-pages-2026-11-23/Brief.md", "SITUATION BRIEF\n\nPurpose: …\n"],
      ["a4-pages-2026-11-23/Charter.md", "AGENT CHARTER\n"],
    ],
  );
  assert.equal(entries[0].time, dosDateTime(new Date(2026, 10, 23, 9, 30, 0).getTime()).time);
  assert.equal(localDate(day), "2026-11-23");
});
