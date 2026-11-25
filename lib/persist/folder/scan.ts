/**
 * The folder list: walk a picked folder, sort its Markdown files into context
 * files and other Markdown, and measure each context file on the 80 × 60
 * Terminal grid.
 */

import { PRESETS, pageFit } from "../../page/index.ts";
import { decodeStrict, MAX_FILE_BYTES, SCAN_ENTRY_LIMIT, walkFolder } from "../store/folder.ts";
import type { FolderFs } from "./fs.ts";
import { baseName, type FilePath } from "../store/refs.ts";
import type { UnreadableReason } from "../store/types.ts";
import { toSheet } from "./faithful.ts";

export type FileGroup = "context" | "letter" | "other";

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

/** The folder letters live in (`add-letters`), relative to the repository folder. */
export const LETTERS_DIR = ".agents/letters";

/** True for a letter: a `.md` file directly inside `.agents/letters/`. */
export function isLetterPath(path: string): boolean {
  if (!path.startsWith(`${LETTERS_DIR}/`)) return false;
  const name = path.slice(LETTERS_DIR.length + 1);
  return !name.includes("/") && name.length > 3 && name.toLowerCase().endsWith(".md");
}

/** A path's group in the folder list. Letters come before the context-file check, so a letter is never "context". */
export function fileGroup(path: string): FileGroup {
  if (isLetterPath(path)) return "letter";
  return isContextFile(path) ? "context" : "other";
}

const GROUP_ORDER: Record<FileGroup, number> = { letter: 0, context: 1, other: 2 };

/** Page rows of the Terminal preset; a context file using more is "over". */
export const PAGE_ROWS = PRESETS.terminal.rows;

/** Rows the sheet would use for a file's raw text on the Terminal grid. */
export function fileRows(raw: string): number {
  return pageFit(toSheet(raw), PRESETS.terminal).rowsUsed;
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

export async function scanFolder(fs: FolderFs, options: { limit?: number } = {}): Promise<FolderScan> {
  const walk = await walkFolder(fs, options.limit ?? SCAN_ENTRY_LIMIT);
  const files = await mapLimited(walk.files, 4, async (path): Promise<FolderFile | null> => {
    const group = fileGroup(path);
    let read: Awaited<ReturnType<FolderFs["readBytes"]>>;
    try {
      // Other Markdown is listed by size and date only; its text isn't read.
      read = await fs.readBytes(path, { maxBytes: group === "other" ? 0 : MAX_FILE_BYTES });
    } catch {
      return null; // Gone since the walk.
    }
    const { stat } = read;
    const base = { path, size: stat.size, modifiedAt: stat.modifiedAt, group };
    if (stat.size > MAX_FILE_BYTES) return { ...base, rows: null, unreadable: "too-large" };
    if (group === "other" || read.bytes === null) return { ...base, rows: null, unreadable: null };
    const text = decodeStrict(read.bytes);
    if (text === null) return { ...base, rows: null, unreadable: "not-utf8" };
    return { ...base, rows: fileRows(text), unreadable: null };
  });
  const listed = files.filter((f): f is FolderFile => f !== null);
  listed.sort((a, b) => GROUP_ORDER[a.group] - GROUP_ORDER[b.group] || a.path.localeCompare(b.path));
  return { files: listed, partial: walk.partial };
}
