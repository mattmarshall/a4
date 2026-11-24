/**
 * Folder backend: Markdown files in a folder the user picked (File System
 * Access API), keyed by relative path. Implements only the core `PageFiles`
 * contract: A4 never renames or deletes a user's files.
 *
 * The store is exact. Reads decode strict UTF-8 and keep a byte-order mark as
 * U+FEFF; writes encode the given text as-is. Faithful line handling for the
 * sheet lives above this, in `lib/folder/faithful.ts`.
 *
 * Writes take a Web Lock per path, verify the expected revision, and replace
 * the file through `createWritable()`, which commits atomically on close.
 */

import { hasFileExtension, parseFilePath, type FilePath } from "./refs.ts";
import { byteLength, revisionOf } from "./revision.ts";
import type { LockLike } from "./opfs.ts";
import {
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
export const SKIPPED_FOLDERS: ReadonlySet<string> = new Set([
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
export const CONTEXT_DOT_FOLDERS: ReadonlySet<string> = new Set([".claude", ".github", ".cursor", ".agents"]);

export function skipFolder(name: string): boolean {
  return SKIPPED_FOLDERS.has(name) || (name.startsWith(".") && !CONTEXT_DOT_FOLDERS.has(name));
}

function errorName(error: unknown): string | undefined {
  return typeof error === "object" && error !== null ? (error as { name?: string }).name : undefined;
}

function isMissing(error: unknown): boolean {
  const name = errorName(error);
  return name === "NotFoundError" || name === "TypeMismatchError";
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

export interface WalkedFile {
  readonly path: FilePath;
  readonly handle: FileSystemFileHandle;
}

export interface WalkResult {
  readonly files: WalkedFile[];
  /** Entries visited, files and folders alike. */
  readonly visited: number;
  /** True when the walk stopped at the limit. */
  readonly partial: boolean;
}

/**
 * Walk a folder breadth-first, collecting `.md` and `.mdc` files and skipping
 * the folders `skipFolder` names. Stops after `limit` entries.
 */
export async function walkFolder(root: FileSystemDirectoryHandle, limit: number = SCAN_ENTRY_LIMIT): Promise<WalkResult> {
  const files: WalkedFile[] = [];
  const queue: { dir: FileSystemDirectoryHandle; prefix: string }[] = [{ dir: root, prefix: "" }];
  let visited = 0;
  while (queue.length > 0) {
    const { dir, prefix } = queue.shift()!;
    try {
      for await (const [name, handle] of dir.entries()) {
        if (visited >= limit) return { files, visited, partial: true };
        visited++;
        if (handle.kind === "directory") {
          if (!skipFolder(name)) queue.push({ dir: handle as FileSystemDirectoryHandle, prefix: `${prefix}${name}/` });
        } else if (hasFileExtension(name)) {
          try {
            files.push({ path: parseFilePath(`${prefix}${name}`), handle: handle as FileSystemFileHandle });
          } catch {
            // A name A4 can't represent as a path (e.g. a backslash): leave it out.
          }
        }
      }
    } catch (error) {
      // The root itself must be readable; a sub-folder that vanished or can't be read is skipped.
      if (prefix === "") throw error;
    }
  }
  return { files, visited, partial: false };
}

async function writeFile(handle: FileSystemFileHandle, text: string): Promise<File> {
  const writable = await handle.createWritable();
  try {
    await writable.write(encoder.encode(text));
    await writable.close();
  } catch (error) {
    await writable.abort().catch(() => {});
    throw error;
  }
  return handle.getFile();
}

export interface FolderPageFilesOptions {
  /** Distinguishes this folder in lock names. */
  id: string;
  locks?: LockLike | null;
}

export class FolderPageFiles implements PageFiles<FilePath> {
  readonly kind = "folder" as const;
  readonly durable = true;
  readonly root: FileSystemDirectoryHandle;
  readonly id: string;
  readonly #locks: LockLike | null;

  constructor(root: FileSystemDirectoryHandle, options: FolderPageFilesOptions) {
    this.root = root;
    this.id = options.id;
    this.#locks =
      options.locks !== undefined
        ? options.locks
        : typeof navigator !== "undefined" && navigator.locks
          ? (navigator.locks as unknown as LockLike)
          : null;
  }

  get name(): string {
    return this.root.name;
  }

  async #locked<T>(path: string, fn: () => Promise<T>): Promise<T> {
    if (!this.#locks) return fn();
    return this.#locks.request(`a4:file:${this.id}:${path}`, fn);
  }

  /** The handle for `path`, or null when it doesn't exist. */
  async handle(path: FilePath, create = false): Promise<FileSystemFileHandle | null> {
    const parts = parseFilePath(path).split("/");
    try {
      let dir = this.root;
      for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part, { create });
      return await dir.getFileHandle(parts[parts.length - 1], { create });
    } catch (error) {
      if (!create && isMissing(error)) return null;
      throw error;
    }
  }

  async list(): Promise<PageSummary<FilePath>[]> {
    const { files } = await walkFolder(this.root);
    const out: PageSummary<FilePath>[] = [];
    for (const { path, handle } of files) {
      const file = await handle.getFile();
      out.push({ name: path, size: file.size, modifiedAt: file.lastModified });
    }
    return out;
  }

  async #readHandle(path: FilePath, handle: FileSystemFileHandle): Promise<Page<FilePath>> {
    let file: File;
    try {
      file = await handle.getFile();
    } catch (error) {
      if (isMissing(error)) throw new PageNotFoundError(path);
      throw error;
    }
    if (file.size > MAX_FILE_BYTES) throw new FileUnreadableError(path, "too-large");
    const text = decodeStrict(await file.arrayBuffer());
    if (text === null) throw new FileUnreadableError(path, "not-utf8");
    return { name: path, text, size: file.size, modifiedAt: file.lastModified, revision: revisionOf(text) };
  }

  async read(path: FilePath): Promise<Page<FilePath>> {
    const handle = await this.handle(path);
    if (!handle) throw new PageNotFoundError(path);
    return this.#readHandle(path, handle);
  }

  async create(path: FilePath, text: string): Promise<WriteResult<FilePath>> {
    const valid = parseFilePath(path);
    return this.#locked(valid, async () => {
      if (await this.handle(valid)) throw new PageExistsError(valid);
      const handle = (await this.handle(valid, true))!;
      const file = await writeFile(handle, text);
      return { name: valid, size: byteLength(text), modifiedAt: file.lastModified, revision: revisionOf(text) };
    });
  }

  async write(path: FilePath, text: string, expected?: Revision | null): Promise<WriteResult<FilePath>> {
    const valid = parseFilePath(path);
    return this.#locked(valid, async () => {
      const handle = await this.handle(valid);
      if (!handle) throw new PageNotFoundError(valid);
      if (expected) {
        let actual: Revision;
        try {
          actual = (await this.#readHandle(valid, handle)).revision;
        } catch (error) {
          // A file that became unreadable no longer matches any revision we hold.
          if (error instanceof FileUnreadableError) throw new PageConflictError(valid, expected, "" as Revision);
          throw error;
        }
        if (actual !== expected) throw new PageConflictError(valid, expected, actual);
      }
      let file: File;
      try {
        file = await writeFile(handle, text);
      } catch (error) {
        if (isMissing(error)) throw new PageNotFoundError(valid);
        throw error;
      }
      return { name: valid, size: byteLength(text), modifiedAt: file.lastModified, revision: revisionOf(text) };
    });
  }
}

/** True when this browser can pick a folder and write to it. */
export function folderPickerSupported(): boolean {
  return typeof window !== "undefined" && typeof (window as { showDirectoryPicker?: unknown }).showDirectoryPicker === "function";
}
