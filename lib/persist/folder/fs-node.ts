/**
 * FolderFs and FolderSource over node:fs, for tests and a future CLI. A
 * "handle" is a directory path. Writes go to a temporary file beside the
 * target and are renamed over it, so they are atomic.
 */

import { link, mkdir, opendir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { FsError, type FileStat, type FolderEntry, type FolderFs, type FolderSource, type WriteOptions } from "./fs.ts";

function codeOf(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
}

function toFsError(error: unknown, path: string): FsError {
  if (error instanceof FsError) return error;
  const code = codeOf(error);
  if (code === "ENOENT" || code === "ENOTDIR") return new FsError("not-found", `“${path}” doesn’t exist.`);
  if (code === "EACCES" || code === "EPERM") return new FsError("not-allowed", `No access to “${path}”.`);
  if (code === "EEXIST") return new FsError("exists", `“${path}” already exists.`);
  return new FsError("failed", error instanceof Error ? error.message : String(error), { cause: error });
}

/**
 * Put the finished temporary file at `target` only if nothing is there: a hard
 * link is atomic and fails with EEXIST instead of replacing a file. On a volume
 * without hard links, an exclusive open still never replaces one, though a
 * reader could briefly see it half written.
 */
async function linkNew(temp: string, target: string, bytes: Uint8Array<ArrayBuffer>): Promise<void> {
  try {
    await link(temp, target);
  } catch (error) {
    const code = codeOf(error);
    if (code !== "EPERM" && code !== "ENOTSUP" && code !== "EOPNOTSUPP") throw error;
    await writeFile(target, bytes, { flag: "wx" });
  }
  await rm(temp, { force: true });
}

class NodeFolderFs implements FolderFs {
  readonly #root: string;
  #temp = 0;

  constructor(root: string) {
    this.#root = root;
  }

  get name(): string {
    return basename(this.#root);
  }

  #abs(path: string): string {
    return path === "" ? this.#root : join(this.#root, ...path.split("/"));
  }

  async *entries(dir: string): AsyncIterable<FolderEntry> {
    try {
      for await (const entry of await opendir(this.#abs(dir))) {
        if (entry.isDirectory()) yield { name: entry.name, kind: "directory" };
        else if (entry.isFile()) yield { name: entry.name, kind: "file" };
      }
    } catch (error) {
      throw toFsError(error, dir || this.name);
    }
  }

  async stat(path: string): Promise<FileStat | null> {
    try {
      const s = await stat(this.#abs(path));
      if (!s.isFile()) return null;
      return { size: s.size, modifiedAt: Math.floor(s.mtimeMs) };
    } catch (error) {
      const failure = toFsError(error, path);
      if (failure.code === "not-found") return null;
      throw failure;
    }
  }

  async readBytes(path: string, options: { maxBytes?: number } = {}) {
    const found = await this.stat(path);
    if (!found) throw new FsError("not-found", `“${path}” doesn’t exist.`);
    if (options.maxBytes !== undefined && found.size > options.maxBytes) return { stat: found, bytes: null };
    try {
      return { stat: found, bytes: new Uint8Array(await readFile(this.#abs(path))) };
    } catch (error) {
      throw toFsError(error, path);
    }
  }

  async writeAtomic(path: string, bytes: Uint8Array<ArrayBuffer>, options: WriteOptions = {}): Promise<FileStat> {
    const target = this.#abs(path);
    const exclusive = options.exclusive ?? false;
    const create = (options.create ?? false) || exclusive;
    if (!create && !(await this.stat(path))) throw new FsError("not-found", `“${path}” doesn’t exist.`);
    const temp = join(dirname(target), `.${basename(target)}.a4-${process.pid}-${++this.#temp}.tmp`);
    try {
      if (create) await mkdir(dirname(target), { recursive: true });
      await writeFile(temp, bytes);
      if (exclusive) await linkNew(temp, target, bytes);
      else await rename(temp, target);
    } catch (error) {
      await rm(temp, { force: true }).catch(() => {});
      throw toFsError(error, path);
    }
    const written = await this.stat(path);
    if (!written) throw new FsError("not-found", `“${path}” doesn’t exist.`);
    return written;
  }
}

/** Node always grants access; two paths are the same folder when they resolve alike. */
export const nodeFolderSource: FolderSource<string> = {
  name: (path) => basename(path),
  async same(a, b) {
    try {
      return (await realpath(a)) === (await realpath(b));
    } catch {
      return false;
    }
  },
  queryPermission: async () => "granted",
  requestPermission: async () => "granted",
  open: (path) => new NodeFolderFs(path),
};
