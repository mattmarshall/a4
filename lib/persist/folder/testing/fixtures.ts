/**
 * The same folder tests on both FolderFs adapters: the File System Access
 * adapter over the in-memory fake (`fake-opfs.ts`), and the node:fs adapter
 * over a real temporary directory.
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { asDirectoryHandle, FakeDirectoryHandle, FakeVolume } from "../../store/testing/fake-opfs.ts";
import { browserFolderSource } from "../fs-browser.ts";
import { nodeFolderSource } from "../fs-node.ts";
import type { FolderSource } from "../fs.ts";

export interface TestFolder<H> {
  readonly handle: H;
  /** Write a file the way another program would. */
  put(path: string, content: string | Uint8Array): Promise<void>;
  /** A file's text, or null when it doesn't exist. */
  text(path: string): Promise<string | null>;
  /** Committed writes to a file, where the adapter can count them. */
  writes(path: string): number | null;
  /** Delete the whole folder. */
  remove(): Promise<void>;
}

export interface FolderFixture<H> {
  readonly label: "browser" | "node";
  readonly source: FolderSource<H>;
  /** A new folder named `name` holding `files`. */
  folder(name: string, files?: Record<string, string | Uint8Array>): Promise<TestFolder<H>>;
  /** For the browser fake: the shared permission state. */
  readonly volume: FakeVolume | null;
  /** Let real file I/O finish (the fake's I/O finishes within the fake scheduler's settle). */
  idle(): Promise<void>;
  dispose(): Promise<void>;
}

export function browserFixture(clock?: () => number): FolderFixture<FileSystemDirectoryHandle> {
  const volume = new FakeVolume(clock);
  const parent = new FakeDirectoryHandle("", volume);
  return {
    label: "browser",
    source: browserFolderSource,
    volume,
    async folder(name, files = {}) {
      const root = await parent.getDirectoryHandle(name, { create: true });
      for (const [path, content] of Object.entries(files)) root.put(path, content);
      return {
        handle: asDirectoryHandle(root),
        async put(path, content) {
          const existing = root.fileAt(path);
          if (existing) existing.setContent(content);
          else root.put(path, content);
        },
        async text(path) {
          return root.fileAt(path)?.text ?? null;
        },
        writes: (path) => root.fileAt(path)?.writes ?? 0,
        remove: () => parent.removeEntry(name, { recursive: true }),
      };
    },
    idle: async () => {},
    dispose: async () => {},
  };
}

export async function nodeFixture(): Promise<FolderFixture<string>> {
  const base = await mkdtemp(join(tmpdir(), "a4-folder-"));
  return {
    label: "node",
    source: nodeFolderSource,
    volume: null,
    async folder(name, files = {}) {
      const root = join(base, name);
      await mkdir(root, { recursive: true });
      const put = async (path: string, content: string | Uint8Array) => {
        const target = join(root, ...path.split("/"));
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, content);
      };
      for (const [path, content] of Object.entries(files)) await put(path, content);
      return {
        handle: root,
        put,
        async text(path) {
          try {
            return await readFile(join(root, ...path.split("/")), "utf8");
          } catch {
            return null;
          }
        },
        writes: () => null,
        remove: () => rm(root, { recursive: true, force: true }),
      };
    },
    idle: async () => {
      for (let i = 0; i < 3; i++) await new Promise((resolve) => setTimeout(resolve, 15));
    },
    dispose: () => rm(base, { recursive: true, force: true }),
  };
}

/** Each adapter's fixture factory, for suites that run once per adapter. */
export const ADAPTERS = [
  { label: "browser", make: async () => browserFixture() },
  { label: "node", make: nodeFixture },
] as const;
