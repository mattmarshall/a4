/**
 * A small, dependency-free zip reader for untrusted archives.
 *
 * Reads the central directory (so entries written with data descriptors
 * work), decodes names (UTF-8 flag, then strict UTF-8, then Windows-1252),
 * and inflates entries lazily with the platform's
 * `DecompressionStream("deflate-raw")`. Archive-level limits are checked
 * before anything is inflated; inflation is cut off past the declared size and
 * every entry's CRC-32 is verified. Zip64, encryption, multi-disk archives,
 * and methods other than stored (0) and deflate (8) are not supported.
 */

import { canCompress, inflateRaw } from "../platform/bytes.ts";
import { crc32 } from "./zip.ts";

export type ZipErrorCode =
  | "not-zip"
  | "zip64"
  | "too-many-entries"
  | "too-large"
  | "corrupt"
  | "unsupported"
  | "encrypted"
  | "checksum";

export class ZipError extends Error {
  readonly code: ZipErrorCode;
  constructor(code: ZipErrorCode, message: string) {
    super(message);
    this.name = "ZipError";
    this.code = code;
  }
}

export interface UnzipLimits {
  /** Most entries an archive may hold (default 5,000). */
  maxEntries: number;
  /** Most total declared uncompressed bytes (default 50 MB). */
  maxTotalBytes: number;
}

export const DEFAULT_UNZIP_LIMITS: UnzipLimits = {
  maxEntries: 5_000,
  maxTotalBytes: 50 * 1024 * 1024,
};

export interface UnzipEntry {
  /** Path inside the archive, "/"-separated. */
  readonly name: string;
  readonly isDirectory: boolean;
  readonly encrypted: boolean;
  readonly method: number;
  readonly compressedSize: number;
  /** Declared uncompressed size. */
  readonly size: number;
  readonly crc: number;
  /** Epoch ms from the entry's DOS date and time (local time). */
  readonly modifiedAt: number;
  /** Inflate and verify the entry. @throws ZipError */
  read(): Promise<Uint8Array>;
}

const SIG_EOCD = 0x06054b50;
const SIG_ZIP64_LOCATOR = 0x07064b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

const utf8 = new TextDecoder("utf-8");
const utf8Strict = new TextDecoder("utf-8", { fatal: true });
const legacy = new TextDecoder("windows-1252");

function decodeName(bytes: Uint8Array, utf8Flag: boolean): string {
  if (utf8Flag) return utf8.decode(bytes);
  try {
    // macOS and many Linux tools write UTF-8 without setting the flag.
    return utf8Strict.decode(bytes);
  } catch {
    return legacy.decode(bytes);
  }
}

function fromDosDateTime(date: number, time: number): number {
  const year = (date >> 9) + 1980;
  const month = Math.max(0, ((date >> 5) & 0x0f) - 1);
  const day = Math.max(1, date & 0x1f);
  return new Date(year, month, day, time >> 11, (time >> 5) & 0x3f, (time & 0x1f) * 2).getTime();
}

async function inflate(data: Uint8Array, expected: number, name: string): Promise<Uint8Array> {
  if (!canCompress()) throw new ZipError("unsupported", "This browser can’t decompress zip entries.");
  let out: Uint8Array | null;
  try {
    out = await inflateRaw(data, expected);
  } catch {
    throw new ZipError("corrupt", `“${name}” is not valid compressed data.`);
  }
  if (!out) throw new ZipError("corrupt", `“${name}” inflates past its declared size.`);
  return out;
}

/** Parse an archive's central directory. Entries are read lazily. @throws ZipError */
export function openZip(bytes: Uint8Array, limits: UnzipLimits = DEFAULT_UNZIP_LIMITS): UnzipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 22) throw new ZipError("not-zip", "This file is not a zip archive.");

  // The end-of-central-directory record may be followed by a comment of up to 64 KB.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipError("not-zip", "This file is not a zip archive.");

  const count = view.getUint16(eocd + 10, true);
  const cdSize = view.getUint32(eocd + 12, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  const zip64Locator = eocd >= 20 && view.getUint32(eocd - 20, true) === SIG_ZIP64_LOCATOR;
  if (zip64Locator || count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    throw new ZipError("zip64", "Zip64 archives aren’t supported.");
  }
  if (view.getUint16(eocd + 4, true) !== 0 || view.getUint16(eocd + 6, true) !== 0) {
    throw new ZipError("unsupported", "Multi-part zip archives aren’t supported.");
  }
  if (count > limits.maxEntries) {
    throw new ZipError(
      "too-many-entries",
      `This archive has ${count.toLocaleString("en-US")} entries; the limit is ${limits.maxEntries.toLocaleString("en-US")}.`,
    );
  }
  if (cdOffset + cdSize > eocd) throw new ZipError("corrupt", "This zip archive is damaged.");

  const entries: UnzipEntry[] = [];
  let at = cdOffset;
  let declared = 0;
  for (let i = 0; i < count; i++) {
    if (at + 46 > eocd || view.getUint32(at, true) !== SIG_CENTRAL) {
      throw new ZipError("corrupt", "This zip archive is damaged.");
    }
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const time = view.getUint16(at + 12, true);
    const date = view.getUint16(at + 14, true);
    const crc = view.getUint32(at + 16, true);
    const compressedSize = view.getUint32(at + 20, true);
    const size = view.getUint32(at + 24, true);
    const nameLen = view.getUint16(at + 28, true);
    const extraLen = view.getUint16(at + 30, true);
    const commentLen = view.getUint16(at + 32, true);
    const localOffset = view.getUint32(at + 42, true);
    if (compressedSize === 0xffffffff || size === 0xffffffff || localOffset === 0xffffffff) {
      throw new ZipError("zip64", "Zip64 archives aren’t supported.");
    }
    if (at + 46 + nameLen > eocd) throw new ZipError("corrupt", "This zip archive is damaged.");
    const name = decodeName(bytes.subarray(at + 46, at + 46 + nameLen), (flags & 0x0800) !== 0);
    const isDirectory = name.endsWith("/");
    if (!isDirectory) declared += size;
    if (declared > limits.maxTotalBytes) {
      throw new ZipError(
        "too-large",
        `This archive expands to more than ${Math.round(limits.maxTotalBytes / (1024 * 1024))} MB.`,
      );
    }

    entries.push({
      name,
      isDirectory,
      encrypted: (flags & 0x0001) !== 0,
      method,
      compressedSize,
      size,
      crc,
      modifiedAt: fromDosDateTime(date, time),
      async read(): Promise<Uint8Array> {
        if (this.encrypted) throw new ZipError("encrypted", `“${name}” is encrypted.`);
        if (method !== 0 && method !== 8) {
          throw new ZipError("unsupported", `“${name}” uses an unsupported compression method (${method}).`);
        }
        if (localOffset + 30 > bytes.length || view.getUint32(localOffset, true) !== SIG_LOCAL) {
          throw new ZipError("corrupt", `“${name}” is damaged.`);
        }
        // The local header's name and extra lengths can differ from the central copy.
        const start =
          localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
        if (start + compressedSize > bytes.length) throw new ZipError("corrupt", `“${name}” is truncated.`);
        const body = bytes.subarray(start, start + compressedSize);
        let data: Uint8Array;
        if (method === 0) {
          if (compressedSize !== size) throw new ZipError("corrupt", `“${name}” is damaged.`);
          data = body;
        } else {
          data = await inflate(body, size, name);
        }
        if (data.length !== size) throw new ZipError("corrupt", `“${name}” is shorter than declared.`);
        if (crc32(data) !== crc) throw new ZipError("checksum", `“${name}” failed its checksum.`);
        return data;
      },
    });
    at += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}
