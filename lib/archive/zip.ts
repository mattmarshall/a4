/**
 * A small, dependency-free zip encoder.
 *
 * Writes standard PKZIP archives: a local header + data per entry, a central
 * directory, and an end-of-central-directory record. Entries are compressed
 * with the platform's `CompressionStream("deflate-raw")` (method 8) when it
 * is available and actually shrinks the data, otherwise stored (method 0).
 * File names are UTF-8 (general-purpose flag bit 11). No Zip64: archives must
 * stay under 4 GB and 65,535 entries.
 */

import { canCompress, deflateRaw } from "../platform/bytes.ts";
import { systemClock, type Clock } from "../platform/clock.ts";

export interface ZipEntry {
  /** Path inside the archive, using "/" separators. */
  name: string;
  data: Uint8Array | string;
  /** Epoch ms; defaults to now. Stored as local DOS time (2 s resolution). */
  modifiedAt?: number;
}

export interface ZipOptions {
  /** Try deflate compression (default true). */
  compress?: boolean;
  /** Dates entries without `modifiedAt` (default: the system clock). */
  clock?: Clock;
}

const encoder = new TextEncoder();

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** DOS date/time words for a timestamp, in local time, clamped to 1980–2107. */
export function dosDateTime(ms: number): { date: number; time: number } {
  const d = new Date(ms);
  const year = Math.min(2107, Math.max(1980, d.getFullYear()));
  if (year !== d.getFullYear()) {
    return { date: ((year - 1980) << 9) | (1 << 5) | 1, time: 0 };
  }
  return {
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
  };
}

/** The entry compressed, or null to store it as it is (nothing to compress, or no CompressionStream). */
async function deflate(data: Uint8Array): Promise<Uint8Array | null> {
  if (!canCompress() || data.length === 0) return null;
  try {
    return await deflateRaw(data);
  } catch {
    return null;
  }
}

const FLAG_UTF8 = 0x0800;
const VERSION_NEEDED = 20; // 2.0: deflate
const VERSION_MADE_BY = (3 << 8) | 20; // Unix, 2.0 (so external attrs carry permissions)
const UNIX_FILE_MODE = 0o100644;

/** Build a zip archive from `entries`, in order. */
export async function createZip(entries: readonly ZipEntry[], options: ZipOptions = {}): Promise<Uint8Array> {
  const compress = options.compress ?? true;
  if (entries.length > 0xffff) throw new Error("Too many entries for a zip without Zip64.");

  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const raw = typeof entry.data === "string" ? encoder.encode(entry.data) : entry.data;
    const crc = crc32(raw);
    const deflated = compress ? await deflate(raw) : null;
    const useDeflate = deflated !== null && deflated.length < raw.length;
    const body = useDeflate ? deflated : raw;
    const method = useDeflate ? 8 : 0;
    const { date, time } = dosDateTime(entry.modifiedAt ?? (options.clock ?? systemClock).now());
    if (offset + 30 + name.length + body.length > 0xffffffff) throw new Error("Archive too large without Zip64.");

    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, VERSION_NEEDED, true);
    lv.setUint16(6, FLAG_UTF8, true);
    lv.setUint16(8, method, true);
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, body.length, true);
    lv.setUint32(22, raw.length, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true);
    local.set(name, 30);

    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, VERSION_MADE_BY, true);
    cv.setUint16(6, VERSION_NEEDED, true);
    cv.setUint16(8, FLAG_UTF8, true);
    cv.setUint16(10, method, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, body.length, true);
    cv.setUint32(24, raw.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint16(30, 0, true); // extra
    cv.setUint16(32, 0, true); // comment
    cv.setUint16(34, 0, true); // disk
    cv.setUint16(36, 0, true); // internal attrs
    cv.setUint32(38, (UNIX_FILE_MODE << 16) >>> 0, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);

    locals.push(local, body);
    centrals.push(central);
    offset += local.length + body.length;
  }

  const centralSize = centrals.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  const out = new Uint8Array(offset + centralSize + end.length);
  let at = 0;
  for (const part of [...locals, ...centrals, end]) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
