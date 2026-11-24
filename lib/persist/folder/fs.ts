/**
 * FolderFs: a picked folder's files by relative POSIX path ("" is the folder
 * itself). The scan, the watcher, and the folder store use only this, so the
 * File System Access API stays in `fs-browser.ts`, and Node tests (or a
 * future CLI) use `fs-node.ts` on a real directory.
 *
 * FolderSource: what the access state machine needs from a picked folder
 * before it can open one: its name, permissions, and whether two picks are
 * the same folder.
 */

export interface FolderEntry {
  readonly name: string;
  readonly kind: "file" | "directory";
}

export interface FileStat {
  readonly size: number;
  /** Epoch milliseconds. */
  readonly modifiedAt: number;
}

export interface FolderFs {
  readonly name: string;
  /** The entries of the folder at `dir` ("" for the root). @throws FsError */
  entries(dir: string): AsyncIterable<FolderEntry>;
  /** A file's size and modification time, or null when it doesn't exist. */
  stat(path: string): Promise<FileStat | null>;
  /**
   * A file's bytes and stat. `bytes` is null when the file is larger than
   * `maxBytes`, so a huge file is never read. @throws FsError("not-found")
   */
  readBytes(path: string, options?: { maxBytes?: number }): Promise<{ stat: FileStat; bytes: Uint8Array | null }>;
  /**
   * Replace a file's bytes all at once. With `create`, a missing file (and
   * missing parent folders) is created, and removed again if the write
   * fails. @throws FsError
   */
  writeAtomic(path: string, bytes: Uint8Array<ArrayBuffer>, options?: { create?: boolean }): Promise<FileStat>;
}

export type FsErrorCode = "not-found" | "not-allowed" | "failed";

/** A file system failure, the same from every adapter. */
export class FsError extends Error {
  readonly code: FsErrorCode;
  constructor(code: FsErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "FsError";
    this.code = code;
  }
}

export function isFsError(error: unknown, code?: FsErrorCode): error is FsError {
  return error instanceof FsError && (code === undefined || error.code === code);
}

export interface FolderSource<H> {
  name(handle: H): string;
  /** True when two picks are the same folder (a re-picked folder keeps its id). */
  same(a: H, b: H): Promise<boolean>;
  /** The current permission, without asking. */
  queryPermission(handle: H): Promise<PermissionState>;
  /** Ask for permission. Browsers require a click. */
  requestPermission(handle: H): Promise<PermissionState>;
  open(handle: H): FolderFs;
}
