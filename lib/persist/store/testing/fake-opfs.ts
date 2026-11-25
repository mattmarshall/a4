/**
 * Minimal in-memory file system handles for Node tests: the Origin Private
 * File System that `OpfsPageStore` uses, and a user-picked folder for
 * `FolderPageFiles`. Implements just the handle methods the stores use, with
 * the same commit-on-close semantics as `createWritable()`.
 *
 * Files hold bytes. A shared `FakeVolume` models what a picked folder adds:
 * a permission state (`queryPermission` / `requestPermission`) and removal
 * (handles to removed entries throw `NotFoundError`).
 *
 * `FakeVolumeOptions` model what browsers and disks do differently, so the
 * contract suites can run against each: names that ignore case (macOS and
 * Windows disks), listings in another order, and `File` snapshots that go
 * stale when the file is written (`NotReadableError`). The defaults are
 * case-sensitive names, insertion order, and snapshots that stay readable.
 */

function domError(name: string, message: string): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

const encoder = new TextEncoder();
// Like Blob.text(): replaces invalid bytes and drops a byte-order mark.
const lenient = new TextDecoder();
// For test assertions: replaces invalid bytes but keeps a byte-order mark.
const exact = new TextDecoder("utf-8", { ignoreBOM: true });

interface FakeFileData {
  bytes: Uint8Array;
  lastModified: number;
  /** Bumped on every committed change, so a snapshot can tell it's stale. */
  version: number;
}

export type FakePermission = "granted" | "prompt" | "denied";

export type FakeListOrder = "insertion" | "reverse" | "sorted";

export interface FakeVolumeOptions {
  /** Names that differ only in case are the same entry, which keeps its first spelling. */
  readonly caseInsensitive?: boolean;
  /** The order `entries()` lists a folder in. */
  readonly listOrder?: FakeListOrder;
  /** Reading a `File` taken before a later write throws `NotReadableError`. */
  readonly staleSnapshots?: boolean;
}

/** Every option that differs from the defaults: what the contract suites also run under. */
export const BROWSER_LIKE: FakeVolumeOptions = { caseInsensitive: true, listOrder: "reverse", staleSnapshots: true };

/** State shared by every handle in one fake tree. */
export class FakeVolume {
  clock: () => number;
  permission: FakePermission = "granted";
  /** What the user answers when `requestPermission` prompts. */
  grantOnRequest = true;
  /** Number of `requestPermission` calls that prompted. */
  prompts = 0;
  /** When true, every `createWritable` fails, as when storage is full. */
  failWritable = false;
  /** When it returns true for a name, `removeEntry` of that name fails, as when the tab dies first. */
  failRemove: ((name: string) => boolean) | null = null;
  readonly caseInsensitive: boolean;
  readonly listOrder: FakeListOrder;
  readonly staleSnapshots: boolean;
  constructor(clock: () => number = Date.now, options: FakeVolumeOptions = {}) {
    this.clock = clock;
    this.caseInsensitive = options.caseInsensitive ?? false;
    this.listOrder = options.listOrder ?? "insertion";
    this.staleSnapshots = options.staleSnapshots ?? false;
  }

  /** The key a name is stored under in a folder. */
  key(name: string): string {
    return this.caseInsensitive ? name.toLocaleLowerCase("en-US") : name;
  }
}

function toBytes(data: string | Uint8Array | ArrayBuffer): Uint8Array {
  if (typeof data === "string") return encoder.encode(data);
  return data instanceof Uint8Array ? new Uint8Array(data) : new Uint8Array(data);
}

function checkAccess(volume: FakeVolume, removed: boolean, what: string) {
  if (removed) throw domError("NotFoundError", `${what} was removed`);
  if (volume.permission !== "granted") throw domError("NotAllowedError", `No permission for ${what}`);
}

export class FakeWritable {
  readonly #file: FakeFileData;
  readonly #owner: FakeFileHandle;
  #chunks: Uint8Array[] = [];
  #closed = false;

  constructor(file: FakeFileData, owner: FakeFileHandle) {
    this.#file = file;
    this.#owner = owner;
  }

  async write(data: string | Uint8Array | ArrayBuffer): Promise<void> {
    const bytes = toBytes(data);
    if (this.#owner.failNextWrite) {
      this.#owner.failNextWrite = false;
      this.#chunks.push(bytes.slice(0, Math.floor(bytes.length / 2)));
      throw domError("QuotaExceededError", "Simulated write failure");
    }
    this.#chunks.push(bytes);
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    const size = this.#chunks.reduce((n, c) => n + c.length, 0);
    const bytes = new Uint8Array(size);
    let at = 0;
    for (const chunk of this.#chunks) {
      bytes.set(chunk, at);
      at += chunk.length;
    }
    this.#file.bytes = bytes;
    this.#file.lastModified = this.#owner.clock();
    this.#file.version++;
    this.#owner.writes++;
  }

  async abort(): Promise<void> {
    this.#closed = true;
    this.#chunks = [];
  }
}

export interface FakeFile {
  size: number;
  lastModified: number;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export class FakeFileHandle {
  readonly kind = "file" as const;
  readonly name: string;
  readonly data: FakeFileData;
  readonly volume: FakeVolume;
  failNextWrite = false;
  removed = false;
  /** Committed writes, for tests that check a file was not rewritten. */
  writes = 0;

  constructor(name: string, volume: FakeVolume | (() => number)) {
    this.name = name;
    this.volume = volume instanceof FakeVolume ? volume : new FakeVolume(volume);
    this.data = { bytes: new Uint8Array(), lastModified: this.volume.clock(), version: 0 };
  }

  get clock(): () => number {
    return this.volume.clock;
  }

  /** Test helper: the content decoded leniently, keeping a byte-order mark. */
  get text(): string {
    return exact.decode(this.data.bytes);
  }

  async getFile(): Promise<FakeFile> {
    checkAccess(this.volume, this.removed, this.name);
    const { bytes, version } = this.data;
    const read = () => {
      if (this.volume.staleSnapshots && this.data.version !== version) {
        throw domError("NotReadableError", `${this.name} changed after this snapshot was taken`);
      }
      return bytes;
    };
    return {
      size: bytes.length,
      lastModified: this.data.lastModified,
      text: async () => lenient.decode(read()),
      arrayBuffer: async () => read().slice().buffer,
    };
  }

  async createWritable(): Promise<FakeWritable> {
    checkAccess(this.volume, this.removed, this.name);
    if (this.volume.failWritable) throw domError("QuotaExceededError", "Storage is full.");
    return new FakeWritable(this.data, this);
  }

  async isSameEntry(other: unknown): Promise<boolean> {
    return other === this;
  }

  /** Test helper: replace the content as another program would. */
  setContent(data: string | Uint8Array, lastModified?: number): void {
    this.data.bytes = toBytes(data);
    this.data.lastModified = lastModified ?? this.volume.clock();
    this.data.version++;
  }
}

export class FakeDirectoryHandle {
  readonly kind = "directory" as const;
  readonly name: string;
  /** Entries by `volume.key(name)`: the name itself, or lowercased when names ignore case. */
  readonly children = new Map<string, FakeFileHandle | FakeDirectoryHandle>();
  readonly volume: FakeVolume;
  removed = false;

  constructor(name = "", volume: FakeVolume | (() => number) = Date.now) {
    this.name = name;
    this.volume = volume instanceof FakeVolume ? volume : new FakeVolume(volume);
  }

  get clock(): () => number {
    return this.volume.clock;
  }

  async getDirectoryHandle(name: string, options: { create?: boolean } = {}): Promise<FakeDirectoryHandle> {
    checkAccess(this.volume, this.removed, this.name);
    if (name.includes("/") || name === "." || name === ".." || name === "") throw new TypeError(`Invalid name ${name}`);
    const existing = this.children.get(this.volume.key(name));
    if (existing instanceof FakeDirectoryHandle) return existing;
    if (existing) throw domError("TypeMismatchError", `${name} is a file`);
    if (!options.create) throw domError("NotFoundError", `No directory ${name}`);
    const dir = new FakeDirectoryHandle(name, this.volume);
    this.children.set(this.volume.key(name), dir);
    return dir;
  }

  async getFileHandle(name: string, options: { create?: boolean } = {}): Promise<FakeFileHandle> {
    checkAccess(this.volume, this.removed, this.name);
    if (name.includes("/") || name === "." || name === ".." || name === "") throw new TypeError(`Invalid name ${name}`);
    const existing = this.children.get(this.volume.key(name));
    if (existing instanceof FakeFileHandle) return existing;
    if (existing) throw domError("TypeMismatchError", `${name} is a directory`);
    if (!options.create) throw domError("NotFoundError", `No file ${name}`);
    const file = new FakeFileHandle(name, this.volume);
    this.children.set(this.volume.key(name), file);
    return file;
  }

  async removeEntry(name: string, options: { recursive?: boolean } = {}): Promise<void> {
    checkAccess(this.volume, this.removed, this.name);
    const entry = this.children.get(this.volume.key(name));
    if (!entry) throw domError("NotFoundError", `No entry ${name}`);
    if (this.volume.failRemove?.(name))
      throw domError("NoModificationAllowedError", `Simulated failure removing ${name}`);
    if (entry instanceof FakeDirectoryHandle && entry.children.size > 0 && !options.recursive) {
      throw domError("InvalidModificationError", `${name} is not empty`);
    }
    this.children.delete(this.volume.key(name));
    markRemoved(entry);
  }

  async *entries(): AsyncGenerator<[string, FakeFileHandle | FakeDirectoryHandle]> {
    checkAccess(this.volume, this.removed, this.name);
    const entries = [...this.children.values()];
    if (this.volume.listOrder === "reverse") entries.reverse();
    if (this.volume.listOrder === "sorted") entries.sort((a, b) => Number(a.name > b.name) - Number(a.name < b.name));
    for (const entry of entries) yield [entry.name, entry];
  }

  async isSameEntry(other: unknown): Promise<boolean> {
    return other === this;
  }

  async queryPermission(_descriptor?: { mode?: "read" | "readwrite" }): Promise<FakePermission> {
    if (this.removed) throw domError("NotFoundError", `${this.name} was removed`);
    return this.volume.permission;
  }

  async requestPermission(_descriptor?: { mode?: "read" | "readwrite" }): Promise<FakePermission> {
    if (this.removed) throw domError("NotFoundError", `${this.name} was removed`);
    if (this.volume.permission === "prompt") {
      this.volume.prompts++;
      this.volume.permission = this.volume.grantOnRequest ? "granted" : "denied";
    }
    return this.volume.permission;
  }

  /** Test helper: write a file at a slash-separated path, creating folders. */
  put(path: string, data: string | Uint8Array, lastModified?: number): FakeFileHandle {
    const parts = path.split("/");
    let dir: FakeDirectoryHandle = this;
    for (const part of parts.slice(0, -1)) {
      let next = dir.children.get(this.volume.key(part));
      if (!(next instanceof FakeDirectoryHandle)) {
        next = new FakeDirectoryHandle(part, this.volume);
        dir.children.set(this.volume.key(part), next);
      }
      dir = next;
    }
    const name = parts[parts.length - 1];
    let file = dir.children.get(this.volume.key(name));
    if (!(file instanceof FakeFileHandle)) {
      file = new FakeFileHandle(name, this.volume);
      dir.children.set(this.volume.key(name), file);
    }
    file.setContent(data, lastModified);
    return file;
  }

  /** Test helper: delete the entry at a slash-separated path, as another program would. */
  remove(path: string): void {
    const parts = path.split("/");
    let dir: FakeDirectoryHandle = this;
    for (const part of parts.slice(0, -1)) {
      const next = dir.children.get(this.volume.key(part));
      if (!(next instanceof FakeDirectoryHandle)) return;
      dir = next;
    }
    const key = this.volume.key(parts[parts.length - 1]);
    const entry = dir.children.get(key);
    if (!entry) return;
    dir.children.delete(key);
    markRemoved(entry);
  }

  /** Test helper: the file at a slash-separated path, or undefined. */
  fileAt(path: string): FakeFileHandle | undefined {
    const parts = path.split("/");
    let dir: FakeDirectoryHandle = this;
    for (const part of parts.slice(0, -1)) {
      const next = dir.children.get(this.volume.key(part));
      if (!(next instanceof FakeDirectoryHandle)) return undefined;
      dir = next;
    }
    const file = dir.children.get(this.volume.key(parts[parts.length - 1]));
    return file instanceof FakeFileHandle ? file : undefined;
  }
}

function markRemoved(entry: FakeFileHandle | FakeDirectoryHandle): void {
  entry.removed = true;
  if (entry instanceof FakeDirectoryHandle) for (const child of entry.children.values()) markRemoved(child);
}

export function asDirectoryHandle(fake: FakeDirectoryHandle): FileSystemDirectoryHandle {
  return fake as unknown as FileSystemDirectoryHandle;
}
