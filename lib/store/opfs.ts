/**
 * Origin Private File System page store (the default backend).
 *
 *   <OPFS root>/a4/pages/<name>.md   one file per page; content = page text
 *   <OPFS root>/a4/trash/<id>.md     trashed pages (id = "<name>.<trashedAt>")
 *
 * Writes take a Web Lock per page, verify the expected revision, then replace
 * the file through `createWritable()`, which commits atomically on close.
 */

import { makeTrashId, parseTrashId } from "./key-value.ts";
import { nextAvailableName, parsePageName, sameName, storedPageName } from "./names.ts";
import { byteLength, revisionOf } from "./revision.ts";
import {
  assertStorableText,
  PageConflictError,
  PageExistsError,
  PageNotFoundError,
  StoreUnavailableError,
  type Page,
  type PageName,
  type PageStore,
  type PageSummary,
  type Revision,
  type TrashEntry,
  type TrashId,
  type WriteResult,
} from "./types.ts";

export const OPFS_APP_DIR = "a4";
export const OPFS_PAGES_DIR = "pages";
export const OPFS_TRASH_DIR = "trash";
export const PAGE_EXTENSION = ".md";

/** The subset of the Web Locks API the store uses. */
export interface LockLike {
  request<T>(name: string, callback: () => Promise<T>): Promise<T>;
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    ((error as { name?: string }).name === "NotFoundError" || (error as { name?: string }).name === "TypeMismatchError")
  );
}

function fileName(name: string): string {
  return `${name}${PAGE_EXTENSION}`;
}

async function* mdFiles(dir: FileSystemDirectoryHandle): AsyncGenerator<[string, FileSystemFileHandle]> {
  for await (const [entryName, handle] of dir.entries()) {
    // Skip folders and anything that is not a page, e.g. Chrome's *.crswap swap files.
    if (handle.kind !== "file" || !entryName.endsWith(PAGE_EXTENSION)) continue;
    yield [entryName.slice(0, -PAGE_EXTENSION.length), handle as FileSystemFileHandle];
  }
}

// Blob.text() drops a leading byte-order mark; pages keep it, so decode exactly.
const exact = new TextDecoder("utf-8", { ignoreBOM: true });

async function readText(file: Blob): Promise<string> {
  return exact.decode(await file.arrayBuffer());
}

/**
 * Create `name` in `dir` and write `text` to it. If the write fails, the new
 * (empty) file is removed again, so a failed create, rename, trash, or restore
 * leaves no empty page behind.
 */
async function createFile(dir: FileSystemDirectoryHandle, name: string, text: string): Promise<File> {
  const handle = await dir.getFileHandle(name, { create: true });
  try {
    return await writeFile(handle, text);
  } catch (error) {
    await dir.removeEntry(name).catch(() => {});
    throw error;
  }
}

async function writeFile(handle: FileSystemFileHandle, text: string): Promise<File> {
  const writable = await handle.createWritable();
  try {
    await writable.write(text);
    await writable.close();
  } catch (error) {
    await writable.abort().catch(() => {});
    throw error;
  }
  return handle.getFile();
}

export class OpfsPageStore implements PageStore {
  readonly kind = "opfs" as const;
  readonly durable = true;
  readonly #pages: FileSystemDirectoryHandle;
  readonly #trash: FileSystemDirectoryHandle;
  readonly #locks: LockLike | null;

  private constructor(pages: FileSystemDirectoryHandle, trash: FileSystemDirectoryHandle, locks: LockLike | null) {
    this.#pages = pages;
    this.#trash = trash;
    this.#locks = locks;
  }

  /**
   * Open (creating if needed) `a4/pages` and `a4/trash` under `root`
   * (default: the origin's OPFS root).
   */
  static async open(
    options: { root?: FileSystemDirectoryHandle; locks?: LockLike | null } = {},
  ): Promise<OpfsPageStore> {
    let root = options.root;
    if (!root) {
      if (typeof navigator === "undefined" || !navigator.storage?.getDirectory) {
        throw new StoreUnavailableError("This browser has no Origin Private File System.");
      }
      root = await navigator.storage.getDirectory();
    }
    const app = await root.getDirectoryHandle(OPFS_APP_DIR, { create: true });
    const pages = await app.getDirectoryHandle(OPFS_PAGES_DIR, { create: true });
    const trash = await app.getDirectoryHandle(OPFS_TRASH_DIR, { create: true });
    const locks =
      options.locks !== undefined
        ? options.locks
        : typeof navigator !== "undefined" && navigator.locks
          ? (navigator.locks as unknown as LockLike)
          : null;
    return new OpfsPageStore(pages, trash, locks);
  }

  async #locked<T>(name: string, fn: () => Promise<T>): Promise<T> {
    if (!this.#locks) return fn();
    return this.#locks.request(`a4:page:${name.toLocaleLowerCase("en-US")}`, fn);
  }

  async #handle(dir: FileSystemDirectoryHandle, stem: string, create = false): Promise<FileSystemFileHandle | null> {
    try {
      return await dir.getFileHandle(fileName(stem), { create });
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async #names(): Promise<PageName[]> {
    const out: PageName[] = [];
    for await (const [stem] of mdFiles(this.#pages)) {
      const name = storedPageName(stem);
      if (name) out.push(name);
    }
    return out;
  }

  async #find(name: string): Promise<PageName | undefined> {
    return (await this.#names()).find((n) => sameName(n, name));
  }

  async list(): Promise<PageSummary[]> {
    const out: PageSummary[] = [];
    for await (const [stem, handle] of mdFiles(this.#pages)) {
      const name = storedPageName(stem);
      if (!name) continue;
      const file = await handle.getFile();
      out.push({ name, size: file.size, modifiedAt: file.lastModified });
    }
    return out;
  }

  async read(name: PageName): Promise<Page> {
    const handle = await this.#handle(this.#pages, name);
    if (!handle) throw new PageNotFoundError(name);
    const file = await handle.getFile();
    const text = await readText(file);
    return { name, text, size: file.size, modifiedAt: file.lastModified, revision: revisionOf(text) };
  }

  async create(name: PageName, text: string): Promise<WriteResult> {
    const valid = parsePageName(name);
    assertStorableText(valid, text);
    return this.#locked(valid, async () => {
      if (await this.#find(valid)) throw new PageExistsError(valid);
      const file = await createFile(this.#pages, fileName(valid), text);
      return { name: valid, size: byteLength(text), modifiedAt: file.lastModified, revision: revisionOf(text) };
    });
  }

  async write(name: PageName, text: string, expected?: Revision | null): Promise<WriteResult> {
    assertStorableText(name, text);
    return this.#locked(name, async () => {
      const handle = await this.#handle(this.#pages, name);
      if (!handle) throw new PageNotFoundError(name);
      if (expected) {
        const actual = revisionOf(await readText(await handle.getFile()));
        if (actual !== expected) throw new PageConflictError(name, expected, actual);
      }
      const file = await writeFile(handle, text);
      return { name, size: byteLength(text), modifiedAt: file.lastModified, revision: revisionOf(text) };
    });
  }

  async rename(from: PageName, to: PageName): Promise<WriteResult> {
    const target = parsePageName(to);
    return this.#locked(from, async () => {
      const source = await this.#handle(this.#pages, from);
      if (!source) throw new PageNotFoundError(from);
      const text = await readText(await source.getFile());
      const clash = await this.#find(target);
      if (clash && clash !== from) throw new PageExistsError(target);
      if (target === from) {
        const file = await source.getFile();
        return { name: from, size: file.size, modifiedAt: file.lastModified, revision: revisionOf(text) };
      }
      // Copy, then delete: a crash in between leaves a duplicate, never a loss.
      const file = await createFile(this.#pages, fileName(target), text);
      await this.#pages.removeEntry(fileName(from));
      return { name: target, size: byteLength(text), modifiedAt: file.lastModified, revision: revisionOf(text) };
    });
  }

  async trash(name: PageName): Promise<TrashEntry> {
    return this.#locked(name, async () => {
      const source = await this.#handle(this.#pages, name);
      if (!source) throw new PageNotFoundError(name);
      const text = await readText(await source.getFile());
      const taken = new Set<string>();
      for await (const [stem] of mdFiles(this.#trash)) taken.add(stem);
      const id = makeTrashId(name, Date.now(), (candidate) => taken.has(candidate));
      await createFile(this.#trash, fileName(id), text);
      await this.#pages.removeEntry(fileName(name));
      return { id, name, size: byteLength(text), trashedAt: parseTrashId(id).trashedAt };
    });
  }

  async listTrash(): Promise<TrashEntry[]> {
    const out: TrashEntry[] = [];
    for await (const [stem, handle] of mdFiles(this.#trash)) {
      const file = await handle.getFile();
      const { name, trashedAt } = parseTrashId(stem);
      out.push({ id: stem as TrashId, name, size: file.size, trashedAt: trashedAt || file.lastModified });
    }
    return out;
  }

  async restore(id: TrashId): Promise<WriteResult> {
    const source = await this.#handle(this.#trash, id);
    if (!source) throw new PageNotFoundError(id);
    const text = await readText(await source.getFile());
    const { name } = parseTrashId(id);
    const target = nextAvailableName(name, await this.#names());
    return this.#locked(target, async () => {
      const file = await createFile(this.#pages, fileName(target), text);
      await this.#trash.removeEntry(fileName(id));
      return { name: target, size: byteLength(text), modifiedAt: file.lastModified, revision: revisionOf(text) };
    });
  }

  async purge(id: TrashId): Promise<void> {
    const handle = await this.#handle(this.#trash, id);
    if (!handle) throw new PageNotFoundError(id);
    await this.#trash.removeEntry(fileName(id));
  }
}

/** True when this browser can host the OPFS store (writable OPFS files). */
export function opfsSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.storage?.getDirectory === "function" &&
    typeof FileSystemFileHandle !== "undefined" &&
    "createWritable" in FileSystemFileHandle.prototype
  );
}
