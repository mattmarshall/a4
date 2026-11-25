/**
 * Origin Private File System page store (the default backend).
 *
 *   <OPFS root>/a4/pages/<name>.md   one file per page; content = page text
 *   <OPFS root>/a4/trash/<id>.md     trashed pages (id = "<name>.<trashedAt>")
 *
 * Writes take a Web Lock per page, verify the expected revision, then replace
 * the file through `createWritable()`, which commits atomically on close.
 */

import { systemClock, type Clock } from "../../platform/clock.ts";
import type { Locks } from "../../platform/locks.ts";
import { claimName, lockNames, type NameLock } from "./claims.ts";
import { pageNameCodec, parsePageName, sameName, sanitizePageName, PAGE_EXTENSION } from "./names.ts";
import { byteLength, revisionOf } from "./revision.ts";
import { makeTrashId, parseTrashId } from "./trash-ids.ts";
import {
  assertStorableText,
  PageConflictError,
  PageExistsError,
  PageNotFoundError,
  type Page,
  type PageName,
  type PageStore,
  type PageSummary,
  type Revision,
  type TrashEntry,
  type TrashId,
  type WriteResult,
} from "./types.ts";

const OPFS_APP_DIR = "a4";
const OPFS_PAGES_DIR = "pages";
const OPFS_TRASH_DIR = "trash";

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
  readonly #locks: Locks | null;
  readonly #clock: Clock;

  private constructor(
    pages: FileSystemDirectoryHandle,
    trash: FileSystemDirectoryHandle,
    locks: Locks | null,
    clock: Clock,
  ) {
    this.#pages = pages;
    this.#trash = trash;
    this.#locks = locks;
    this.#clock = clock;
  }

  /** Open (creating if needed) `a4/pages` and `a4/trash` under `root`, the origin's OPFS root. */
  static async open(
    root: FileSystemDirectoryHandle,
    options: { locks?: Locks | null; clock?: Clock } = {},
  ): Promise<OpfsPageStore> {
    const app = await root.getDirectoryHandle(OPFS_APP_DIR, { create: true });
    const pages = await app.getDirectoryHandle(OPFS_PAGES_DIR, { create: true });
    const trash = await app.getDirectoryHandle(OPFS_TRASH_DIR, { create: true });
    return new OpfsPageStore(pages, trash, options.locks ?? null, options.clock ?? systemClock);
  }

  async #locked<T>(name: string, fn: () => Promise<T>): Promise<T> {
    if (!this.#locks) return fn();
    return this.#locks.request(`a4:page:${name.toLocaleLowerCase("en-US")}`, fn);
  }

  readonly #lock: NameLock = (name, fn) => this.#locked(name, fn);

  /** What `claimName` needs: the names taken now, and the lock. */
  readonly #claims = { names: () => this.#names(), lock: this.#lock };

  /** Create a page; the caller holds `name`'s lock. */
  async #createHeld(name: PageName, text: string): Promise<WriteResult> {
    if (await this.#find(name)) throw new PageExistsError(name);
    const file = await createFile(this.#pages, fileName(name), text);
    return { name, size: byteLength(text), modifiedAt: file.lastModified, revision: revisionOf(text) };
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
      const name = pageNameCodec.parse(stem);
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
      const name = pageNameCodec.parse(stem);
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
    return this.#locked(valid, () => this.#createHeld(valid, text));
  }

  async createUnique(desired: string, text: string): Promise<WriteResult> {
    assertStorableText(sanitizePageName(desired), text);
    return claimName(desired, this.#claims, (name) => this.#createHeld(name, text));
  }

  async write(name: PageName, text: string, expected?: Revision | null): Promise<WriteResult> {
    assertStorableText(name, text);
    return this.#locked(name, async () => {
      const handle = await this.#handle(this.#pages, name);
      if (!handle) throw new PageNotFoundError(name);
      if (expected != null) {
        const actual = revisionOf(await readText(await handle.getFile()));
        if (actual !== expected) throw new PageConflictError(name, expected, actual);
      }
      const file = await writeFile(handle, text);
      return { name, size: byteLength(text), modifiedAt: file.lastModified, revision: revisionOf(text) };
    });
  }

  async rename(from: PageName, to: PageName): Promise<WriteResult> {
    const target = parsePageName(to);
    if (target !== from && sameName(target, from)) return this.#renameCase(from, target);
    // Both names, so no other tab can take the target meanwhile.
    return lockNames(this.#lock, [from, target], async () => {
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

  /**
   * A rename that changes only case. Storage that ignores case sees one file
   * under both spellings, so copying to the target and deleting the source
   * would delete the page. Go through a temporary page instead; each step
   * copies, then deletes, so the text always has a name the library lists.
   */
  async #renameCase(from: PageName, target: PageName): Promise<WriteResult> {
    return this.#locked(from, async () => {
      const source = await this.#handle(this.#pages, from);
      if (!source) throw new PageNotFoundError(from);
      const text = await readText(await source.getFile());
      const temporary = await claimName(`${from} (renaming)`, this.#claims, (name) => this.#createHeld(name, text));
      await this.#pages.removeEntry(fileName(from));
      const file = await createFile(this.#pages, fileName(target), text);
      await this.#pages.removeEntry(fileName(temporary.name));
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
      const { id, trashedAt } = makeTrashId(name, this.#clock.now(), (candidate) => taken.has(candidate));
      await createFile(this.#trash, fileName(id), text);
      await this.#pages.removeEntry(fileName(name));
      return { id, name, size: byteLength(text), trashedAt };
    });
  }

  async listTrash(): Promise<TrashEntry[]> {
    const out: TrashEntry[] = [];
    for await (const [stem, handle] of mdFiles(this.#trash)) {
      const parts = parseTrashId(stem);
      if (!parts) continue;
      const file = await handle.getFile();
      out.push({ ...parts, size: file.size, trashedAt: parts.trashedAt || file.lastModified });
    }
    return out;
  }

  async restore(id: TrashId): Promise<WriteResult> {
    const source = await this.#handle(this.#trash, id);
    const parts = parseTrashId(id);
    if (!source || !parts) throw new PageNotFoundError(id);
    const text = await readText(await source.getFile());
    return claimName(parts.name, this.#claims, async (target) => {
      const result = await this.#createHeld(target, text);
      await this.#trash.removeEntry(fileName(id));
      return result;
    });
  }

  async purge(id: TrashId): Promise<void> {
    const handle = await this.#handle(this.#trash, id);
    if (!handle) throw new PageNotFoundError(id);
    await this.#trash.removeEntry(fileName(id));
  }
}
