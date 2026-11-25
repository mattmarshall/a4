/** FolderFs and FolderSource over the File System Access API. */

import { FsError, type FileStat, type FolderEntry, type FolderFs, type FolderSource, type WriteOptions } from "./fs.ts";

function errorName(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "name" in error && typeof error.name === "string"
    ? error.name
    : undefined;
}

/** The one place DOMException names become FsError codes. */
function toFsError(error: unknown, path: string): FsError {
  if (error instanceof FsError) return error;
  const name = errorName(error);
  const message = error instanceof Error ? error.message : String(error);
  if (name === "NotFoundError" || name === "TypeMismatchError") {
    return new FsError("not-found", `“${path}” doesn’t exist.`, { cause: error });
  }
  if (name === "NotAllowedError" || name === "SecurityError") {
    return new FsError("not-allowed", `The browser didn’t allow access to “${path}”.`, { cause: error });
  }
  return new FsError("failed", message, { cause: error });
}

function parts(path: string): string[] {
  return path === "" ? [] : path.split("/");
}

function statOf(file: File): FileStat {
  return { size: file.size, modifiedAt: file.lastModified };
}

class HandleFolderFs implements FolderFs {
  readonly #root: FileSystemDirectoryHandle;

  constructor(root: FileSystemDirectoryHandle) {
    this.#root = root;
  }

  get name(): string {
    return this.#root.name;
  }

  async #dir(path: string, create = false): Promise<FileSystemDirectoryHandle> {
    let dir = this.#root;
    for (const part of parts(path)) dir = await dir.getDirectoryHandle(part, { create });
    return dir;
  }

  async #file(path: string, create = false): Promise<FileSystemFileHandle> {
    const segments = parts(path);
    const name = segments.pop() ?? "";
    const dir = await this.#dir(segments.join("/"), create);
    return dir.getFileHandle(name, { create });
  }

  async *entries(dir: string): AsyncIterable<FolderEntry> {
    let handle: FileSystemDirectoryHandle;
    try {
      handle = await this.#dir(dir);
    } catch (error) {
      throw toFsError(error, dir || this.name);
    }
    try {
      for await (const [name, entry] of handle.entries()) yield { name, kind: entry.kind };
    } catch (error) {
      throw toFsError(error, dir || this.name);
    }
  }

  async stat(path: string): Promise<FileStat | null> {
    try {
      return statOf(await (await this.#file(path)).getFile());
    } catch (error) {
      const failure = toFsError(error, path);
      if (failure.code === "not-found") return null;
      throw failure;
    }
  }

  async readBytes(path: string, options: { maxBytes?: number } = {}) {
    try {
      const file = await (await this.#file(path)).getFile();
      const stat = statOf(file);
      if (options.maxBytes !== undefined && file.size > options.maxBytes) return { stat, bytes: null };
      return { stat, bytes: new Uint8Array(await file.arrayBuffer()) };
    } catch (error) {
      throw toFsError(error, path);
    }
  }

  async writeAtomic(path: string, bytes: Uint8Array<ArrayBuffer>, options: WriteOptions = {}): Promise<FileStat> {
    const exclusive = options.exclusive ?? false;
    const create = (options.create ?? false) || exclusive;
    let handle: FileSystemFileHandle;
    let existed = true;
    try {
      if (create) existed = (await this.stat(path)) !== null;
      // No exclusive create in this API: the check above, under the callers' locks, is the guard.
      if (exclusive && existed) throw new FsError("exists", `“${path}” already exists.`);
      handle = await this.#file(path, create);
    } catch (error) {
      throw toFsError(error, path);
    }
    // createWritable() commits on close, so the file changes all at once or not at all.
    try {
      const writable = await handle.createWritable();
      try {
        await writable.write(bytes);
        await writable.close();
      } catch (error) {
        await writable.abort().catch(() => {});
        throw error;
      }
      return statOf(await handle.getFile());
    } catch (error) {
      if (!existed) await this.#remove(path).catch(() => {});
      throw toFsError(error, path);
    }
  }

  async #remove(path: string): Promise<void> {
    const segments = parts(path);
    const name = segments.pop() ?? "";
    await (await this.#dir(segments.join("/"))).removeEntry(name);
  }
}

interface PermissionHandle {
  queryPermission?(descriptor: { mode: "readwrite" }): Promise<PermissionState>;
  requestPermission?(descriptor: { mode: "readwrite" }): Promise<PermissionState>;
}

/** Browsers without the permission methods grant access for the page's life. */
export const browserFolderSource: FolderSource<FileSystemDirectoryHandle> = {
  name: (handle) => handle.name,
  same: (a, b) => a.isSameEntry(b),
  async queryPermission(handle) {
    const query = (handle as PermissionHandle).queryPermission;
    try {
      return query ? await query.call(handle, { mode: "readwrite" }) : "granted";
    } catch (error) {
      throw toFsError(error, handle.name);
    }
  },
  async requestPermission(handle) {
    const request = (handle as PermissionHandle).requestPermission;
    try {
      return request ? await request.call(handle, { mode: "readwrite" }) : "granted";
    } catch (error) {
      throw toFsError(error, handle.name);
    }
  },
  open: (handle) => new HandleFolderFs(handle),
};
