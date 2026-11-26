/**
 * The part of the File System Access handles that OpfsPageStore uses, over
 * node:fs, so `a4 serve` keeps a library as Markdown files in a folder with
 * the same store (and the same contract) as the browser's OPFS library.
 *
 * - `getDirectoryHandle`, `getFileHandle` (creating an empty file, as OPFS
 *   does), `entries`, and `removeEntry`.
 * - `createWritable` buffers what's written and, on `close()`, writes a
 *   temporary file beside the target and renames it over it, so a page is
 *   replaced atomically, as the browser's commit is.
 * - `getFile()` returns the bytes, with the file's modification time.
 *
 * Errors carry the DOMException names the store checks: NotFoundError and
 * TypeMismatchError.
 */

import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { inProcessLocks } from "../../platform/locks.ts";
import { OpfsPageStore } from "./opfs.ts";
import type { PageStore } from "./types.ts";

function codeOf(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error ? String(error.code) : undefined;
}

const notFound = (path: string) => new DOMException(`“${path}” doesn’t exist.`, "NotFoundError");
const mismatch = (path: string) => new DOMException(`“${path}” is the wrong kind of entry.`, "TypeMismatchError");

/** A name that stays inside its folder: no separators, and not "." or "..". */
function checkName(name: string): void {
  if (!name || name === "." || name === ".." || /[/\\\0]/.test(name)) {
    throw new TypeError(`“${name}” isn’t a valid entry name.`);
  }
}

class NodeWritable {
  readonly #path: string;
  readonly #chunks: Uint8Array[] = [];
  #done = false;

  constructor(path: string) {
    this.#path = path;
  }

  async write(data: string | Uint8Array | ArrayBuffer): Promise<void> {
    if (this.#done) throw new TypeError("The file is already closed.");
    if (typeof data === "string") this.#chunks.push(new TextEncoder().encode(data));
    else this.#chunks.push(data instanceof Uint8Array ? data : new Uint8Array(data));
  }

  async close(): Promise<void> {
    if (this.#done) return;
    this.#done = true;
    const temporary = `${this.#path}.a4tmp-${randomBytes(6).toString("hex")}`;
    try {
      await writeFile(temporary, Buffer.concat(this.#chunks));
      await rename(temporary, this.#path);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => {});
      throw error;
    }
  }

  async abort(): Promise<void> {
    this.#done = true;
  }
}

class NodeFileHandle {
  readonly kind = "file" as const;
  readonly name: string;
  readonly #path: string;

  constructor(path: string, name: string) {
    this.#path = path;
    this.name = name;
  }

  async getFile(): Promise<File> {
    try {
      const [bytes, info] = await Promise.all([readFile(this.#path), stat(this.#path)]);
      return new File([new Uint8Array(bytes)], this.name, { lastModified: Math.round(info.mtimeMs) });
    } catch (error) {
      if (codeOf(error) === "ENOENT") throw notFound(this.#path);
      throw error;
    }
  }

  async createWritable(): Promise<NodeWritable> {
    return new NodeWritable(this.#path);
  }
}

class NodeDirectoryHandle {
  readonly kind = "directory" as const;
  readonly name: string;
  readonly #path: string;

  constructor(path: string, name = "") {
    this.#path = path;
    this.name = name;
  }

  async getDirectoryHandle(name: string, options: { create?: boolean } = {}): Promise<NodeDirectoryHandle> {
    checkName(name);
    const path = join(this.#path, name);
    const info = await stat(path).catch(() => null);
    if (info && !info.isDirectory()) throw mismatch(path);
    if (!info) {
      if (!options.create) throw notFound(path);
      await mkdir(path, { recursive: true });
    }
    return new NodeDirectoryHandle(path, name);
  }

  async getFileHandle(name: string, options: { create?: boolean } = {}): Promise<NodeFileHandle> {
    checkName(name);
    const path = join(this.#path, name);
    const info = await stat(path).catch(() => null);
    if (info && !info.isFile()) throw mismatch(path);
    if (!info) {
      if (!options.create) throw notFound(path);
      // As in OPFS, creating a file handle makes an empty file; "a" never truncates one that appeared meanwhile.
      await writeFile(path, "", { flag: "a" });
    }
    return new NodeFileHandle(path, name);
  }

  async removeEntry(name: string): Promise<void> {
    checkName(name);
    const path = join(this.#path, name);
    try {
      await rm(path);
    } catch (error) {
      if (codeOf(error) === "ENOENT") throw notFound(path);
      throw error;
    }
  }

  async *entries(): AsyncGenerator<[string, NodeFileHandle | NodeDirectoryHandle]> {
    for (const entry of await readdir(this.#path, { withFileTypes: true })) {
      const path = join(this.#path, entry.name);
      if (entry.isDirectory()) yield [entry.name, new NodeDirectoryHandle(path, entry.name)];
      else if (entry.isFile()) yield [entry.name, new NodeFileHandle(path, entry.name)];
    }
  }
}

/** A folder on disk as the directory handle OpfsPageStore opens, created if it's missing. */
export async function nodeDirectory(path: string): Promise<FileSystemDirectoryHandle> {
  await mkdir(path, { recursive: true });
  return new NodeDirectoryHandle(path) as unknown as FileSystemDirectoryHandle;
}

/**
 * The library `a4 serve` keeps in a folder: pages in `pages/`, trashed pages
 * in `trash/`, with writes to each page taken one at a time in this process.
 */
export async function openFolderLibrary(path: string): Promise<PageStore> {
  return OpfsPageStore.open(await nodeDirectory(path), { locks: inProcessLocks(), appDir: null });
}
