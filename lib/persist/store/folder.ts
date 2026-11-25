/**
 * Folder backend: Markdown files in a folder the user picked, keyed by
 * relative path, over the `FolderFs` port (lib/folder/fs.ts). Implements
 * only the core `PageFiles` contract: A4 never renames or deletes a user's
 * files.
 *
 * The store is exact. Reads decode strict UTF-8 and keep a byte-order mark as
 * U+FEFF; writes encode the given text as-is. Faithful line handling for the
 * sheet lives above this, in `lib/folder/faithful.ts`.
 *
 * Writes take a Web Lock per path, verify the expected revision, and replace
 * the file with `FolderFs.writeAtomic`, all at once.
 */

import { isFsError, type FolderFs } from "../folder/fs.ts";
import type { Locks } from "../../platform/locks.ts";
import { filePathCodec, hasFileExtension, parseFilePath, type FilePath } from "./refs.ts";
import { byteLength, revisionOf } from "./revision.ts";
import {
  assertStorableText,
  FileUnreadableError,
  PageConflictError,
  PageExistsError,
  PageNotFoundError,
  type Page,
  type PageFiles,
  type PageSummary,
  type Revision,
  type WriteResult,
} from "./types.ts";

/** Files larger than this are listed but not opened: 1 MiB. */
export const MAX_FILE_BYTES = 1_048_576;
/** The scan stops after visiting this many entries. */
export const SCAN_ENTRY_LIMIT = 20_000;

/** Folders the scan never enters. */
const SKIPPED_FOLDERS: ReadonlySet<string> = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "out",
  "target",
  "vendor",
  ".next",
  ".venv",
]);
/** Dot-folders the scan does enter: they hold agent context. */
const CONTEXT_DOT_FOLDERS: ReadonlySet<string> = new Set([".claude", ".github", ".cursor", ".agents"]);

function skipFolder(name: string): boolean {
  return SKIPPED_FOLDERS.has(name) || (name.startsWith(".") && !CONTEXT_DOT_FOLDERS.has(name));
}

const strict = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const encoder = new TextEncoder();

/** Decode file bytes as strict UTF-8, keeping a byte-order mark. Null when invalid. */
export function decodeStrict(bytes: ArrayBuffer | Uint8Array): string | null {
  try {
    return strict.decode(bytes);
  } catch {
    return null;
  }
}

export interface WalkResult {
  readonly files: FilePath[];
  /** Entries visited, files and folders alike. */
  readonly visited: number;
  /** True when the walk stopped at the limit. */
  readonly partial: boolean;
}

/**
 * Walk a folder breadth-first, collecting `.md` and `.mdc` files and skipping
 * the folders `skipFolder` names. Stops after `limit` entries.
 */
export async function walkFolder(fs: FolderFs, limit: number = SCAN_ENTRY_LIMIT): Promise<WalkResult> {
  const files: FilePath[] = [];
  const queue: string[] = [""];
  let visited = 0;
  for (let dir = queue.shift(); dir !== undefined; dir = queue.shift()) {
    const prefix = dir === "" ? "" : `${dir}/`;
    try {
      for await (const { name, kind } of fs.entries(dir)) {
        if (visited >= limit) return { files, visited, partial: true };
        visited++;
        if (kind === "directory") {
          if (!skipFolder(name)) queue.push(`${prefix}${name}`);
        } else if (hasFileExtension(name)) {
          // A name A4 can't represent as a path (e.g. a backslash) is left out.
          const path = filePathCodec.parse(`${prefix}${name}`);
          if (path) files.push(path);
        }
      }
    } catch (error) {
      // The root itself must be readable; a sub-folder that vanished or can't be read is skipped.
      if (dir === "") throw error;
    }
  }
  return { files, visited, partial: false };
}

export interface FolderPageFilesOptions {
  /** Distinguishes this folder in lock names. */
  id: string;
  /** Web Locks shared with other tabs, or null for none. */
  locks: Locks | null;
  /** Where `list` stops, like the scan (default `SCAN_ENTRY_LIMIT` entries). */
  scanLimit?: number;
}

export class FolderPageFiles implements PageFiles<FilePath> {
  readonly kind = "folder" as const;
  readonly durable = true;
  readonly id: string;
  readonly fs: FolderFs;
  readonly #locks: Locks | null;
  readonly #scanLimit: number;

  constructor(fs: FolderFs, options: FolderPageFilesOptions) {
    this.fs = fs;
    this.id = options.id;
    this.#locks = options.locks;
    this.#scanLimit = options.scanLimit ?? SCAN_ENTRY_LIMIT;
  }

  get name(): string {
    return this.fs.name;
  }

  async #locked<T>(path: string, fn: () => Promise<T>): Promise<T> {
    if (!this.#locks) return fn();
    return this.#locks.request(`a4:file:${this.id}:${path}`, fn);
  }

  async list(): Promise<PageSummary<FilePath>[]> {
    const { files } = await walkFolder(this.fs, this.#scanLimit);
    const out: PageSummary<FilePath>[] = [];
    for (const path of files) {
      const stat = await this.fs.stat(path);
      if (stat) out.push({ name: path, size: stat.size, modifiedAt: stat.modifiedAt });
    }
    return out;
  }

  async read(path: FilePath): Promise<Page<FilePath>> {
    const valid = parseFilePath(path);
    let read: Awaited<ReturnType<FolderFs["readBytes"]>>;
    try {
      read = await this.fs.readBytes(valid, { maxBytes: MAX_FILE_BYTES });
    } catch (error) {
      if (isFsError(error, "not-found")) throw new PageNotFoundError(valid);
      throw error;
    }
    if (read.bytes === null) throw new FileUnreadableError(valid, "too-large");
    const text = decodeStrict(read.bytes);
    if (text === null) throw new FileUnreadableError(valid, "not-utf8");
    return { name: valid, text, size: read.stat.size, modifiedAt: read.stat.modifiedAt, revision: revisionOf(text) };
  }

  async create(path: FilePath, text: string): Promise<WriteResult<FilePath>> {
    const valid = parseFilePath(path);
    assertStorableText(valid, text);
    return this.#locked(valid, async () => {
      if (await this.fs.stat(valid)) throw new PageExistsError(valid);
      const stat = await this.fs.writeAtomic(valid, encoder.encode(text), { create: true });
      return { name: valid, size: byteLength(text), modifiedAt: stat.modifiedAt, revision: revisionOf(text) };
    });
  }

  async write(path: FilePath, text: string, expected?: Revision | null): Promise<WriteResult<FilePath>> {
    const valid = parseFilePath(path);
    assertStorableText(valid, text);
    return this.#locked(valid, async () => {
      if (expected != null) {
        let actual: Revision;
        try {
          actual = (await this.read(valid)).revision;
        } catch (error) {
          // A file that became unreadable no longer matches any revision we hold.
          if (error instanceof FileUnreadableError) throw new PageConflictError(valid, expected, null);
          throw error;
        }
        if (actual !== expected) throw new PageConflictError(valid, expected, actual);
      }
      let stat: Awaited<ReturnType<FolderFs["writeAtomic"]>>;
      try {
        stat = await this.fs.writeAtomic(valid, encoder.encode(text));
      } catch (error) {
        if (isFsError(error, "not-found")) throw new PageNotFoundError(valid);
        throw error;
      }
      return { name: valid, size: byteLength(text), modifiedAt: stat.modifiedAt, revision: revisionOf(text) };
    });
  }
}
