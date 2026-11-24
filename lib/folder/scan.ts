/**
 * The folder list: walk a picked folder, sort its Markdown files into context
 * files and other Markdown, and measure each context file on the 80 × 60
 * Terminal grid.
 */

import { PRESETS } from "../page-spec.ts";
import { decodeStrict, MAX_FILE_BYTES, SCAN_ENTRY_LIMIT, walkFolder } from "../store/folder.ts";
import { baseName, type FilePath } from "../store/refs.ts";
import type { UnreadableReason } from "../store/types.ts";
import { layoutRows, rowsUsed } from "../text.ts";
import { toSheet } from "./faithful.ts";

export type FileGroup = "context" | "other";

export interface FolderFile {
  readonly path: FilePath;
  readonly size: number;
  readonly modifiedAt: number;
  readonly group: FileGroup;
  /** Rows used on the Terminal grid (context files that could be read). */
  readonly rows: number | null;
  /** Why the file can't be opened, when known. */
  readonly unreadable: UnreadableReason | null;
}

export interface FolderScan {
  readonly files: FolderFile[];
  /** True when the scan stopped at the entry limit. */
  readonly partial: boolean;
}

const CONTEXT_NAMES = new Set(["agents.md", "claude.md", "claude.local.md", "gemini.md", "skill.md"]);
const CONTEXT_PATHS = [
  /(^|\/)\.claude\/(agents|commands)\/.+\.md$/i,
  /(^|\/)\.github\/copilot-instructions\.md$/i,
  /(^|\/)\.github\/instructions\/[^/]+\.instructions\.md$/i,
  /(^|\/)\.cursor\/rules\/.+\.mdc$/i,
];

/** True for the agent context files the folder section lists first. */
export function isContextFile(path: string): boolean {
  return CONTEXT_NAMES.has(baseName(path).toLowerCase()) || CONTEXT_PATHS.some((re) => re.test(path));
}

/** Page rows of the Terminal preset; a context file using more is "over". */
export const PAGE_ROWS = PRESETS.terminal.rows;
const PAGE_COLS = PRESETS.terminal.cols;

/** Rows the sheet would use for a file's raw text on the Terminal grid. */
export function fileRows(raw: string): number {
  return rowsUsed(layoutRows(toSheet(raw), PAGE_COLS));
}

async function mapLimited<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

export async function scanFolder(root: FileSystemDirectoryHandle, options: { limit?: number } = {}): Promise<FolderScan> {
  const walk = await walkFolder(root, options.limit ?? SCAN_ENTRY_LIMIT);
  const files = await mapLimited(walk.files, 4, async ({ path, handle }): Promise<FolderFile | null> => {
    let file: File;
    try {
      file = await handle.getFile();
    } catch {
      return null; // Gone since the walk.
    }
    const group: FileGroup = isContextFile(path) ? "context" : "other";
    const base = { path, size: file.size, modifiedAt: file.lastModified, group };
    if (file.size > MAX_FILE_BYTES) return { ...base, rows: null, unreadable: "too-large" };
    if (group === "other") return { ...base, rows: null, unreadable: null };
    const text = decodeStrict(await file.arrayBuffer());
    if (text === null) return { ...base, rows: null, unreadable: "not-utf8" };
    return { ...base, rows: fileRows(text), unreadable: null };
  });
  const listed = files.filter((f): f is FolderFile => f !== null);
  listed.sort((a, b) => (a.group === b.group ? a.path.localeCompare(b.path) : a.group === "context" ? -1 : 1));
  return { files: listed, partial: walk.partial };
}
