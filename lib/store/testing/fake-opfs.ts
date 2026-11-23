/**
 * Minimal in-memory Origin Private File System for Node tests. Implements just
 * the handle methods `OpfsPageStore` uses, with the same commit-on-close
 * semantics as `createWritable()`.
 */

function domError(name: string, message: string): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

interface FakeFileData {
  text: string;
  lastModified: number;
}

export class FakeWritable {
  readonly #file: FakeFileData;
  readonly #owner: FakeFileHandle;
  #chunks: string[] = [];
  #closed = false;

  constructor(file: FakeFileData, owner: FakeFileHandle) {
    this.#file = file;
    this.#owner = owner;
  }

  async write(data: string): Promise<void> {
    if (this.#owner.failNextWrite) {
      this.#owner.failNextWrite = false;
      this.#chunks.push(data.slice(0, Math.floor(data.length / 2)));
      throw domError("QuotaExceededError", "Simulated write failure");
    }
    this.#chunks.push(data);
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#file.text = this.#chunks.join("");
    this.#file.lastModified = this.#owner.clock();
  }

  async abort(): Promise<void> {
    this.#closed = true;
    this.#chunks = [];
  }
}

export class FakeFileHandle {
  readonly kind = "file" as const;
  readonly name: string;
  readonly data: FakeFileData;
  readonly clock: () => number;
  failNextWrite = false;

  constructor(name: string, clock: () => number) {
    this.name = name;
    this.clock = clock;
    this.data = { text: "", lastModified: clock() };
  }

  async getFile(): Promise<{ size: number; lastModified: number; text(): Promise<string> }> {
    const text = this.data.text;
    return {
      size: new TextEncoder().encode(text).length,
      lastModified: this.data.lastModified,
      text: async () => text,
    };
  }

  async createWritable(): Promise<FakeWritable> {
    return new FakeWritable(this.data, this);
  }
}

export class FakeDirectoryHandle {
  readonly kind = "directory" as const;
  readonly name: string;
  readonly children = new Map<string, FakeFileHandle | FakeDirectoryHandle>();
  readonly clock: () => number;

  constructor(name = "", clock: () => number = Date.now) {
    this.name = name;
    this.clock = clock;
  }

  async getDirectoryHandle(name: string, options: { create?: boolean } = {}): Promise<FakeDirectoryHandle> {
    const existing = this.children.get(name);
    if (existing instanceof FakeDirectoryHandle) return existing;
    if (existing) throw domError("TypeMismatchError", `${name} is a file`);
    if (!options.create) throw domError("NotFoundError", `No directory ${name}`);
    const dir = new FakeDirectoryHandle(name, this.clock);
    this.children.set(name, dir);
    return dir;
  }

  async getFileHandle(name: string, options: { create?: boolean } = {}): Promise<FakeFileHandle> {
    if (name.includes("/") || name === "." || name === "..") throw new TypeError(`Invalid name ${name}`);
    const existing = this.children.get(name);
    if (existing instanceof FakeFileHandle) return existing;
    if (existing) throw domError("TypeMismatchError", `${name} is a directory`);
    if (!options.create) throw domError("NotFoundError", `No file ${name}`);
    const file = new FakeFileHandle(name, this.clock);
    this.children.set(name, file);
    return file;
  }

  async removeEntry(name: string): Promise<void> {
    if (!this.children.delete(name)) throw domError("NotFoundError", `No entry ${name}`);
  }

  async *entries(): AsyncGenerator<[string, FakeFileHandle | FakeDirectoryHandle]> {
    for (const entry of [...this.children.entries()]) yield entry;
  }

  /** Test helper: the file at a slash-separated path, or undefined. */
  fileAt(path: string): FakeFileHandle | undefined {
    const parts = path.split("/");
    let dir: FakeDirectoryHandle = this;
    for (const part of parts.slice(0, -1)) {
      const next = dir.children.get(part);
      if (!(next instanceof FakeDirectoryHandle)) return undefined;
      dir = next;
    }
    const file = dir.children.get(parts[parts.length - 1]);
    return file instanceof FakeFileHandle ? file : undefined;
  }
}

export function asDirectoryHandle(fake: FakeDirectoryHandle): FileSystemDirectoryHandle {
  return fake as unknown as FileSystemDirectoryHandle;
}
