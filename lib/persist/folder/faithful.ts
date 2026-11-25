/**
 * Faithful saves: the sheet sees normalized text, and the file keeps every
 * line the author didn't touch byte for byte.
 *
 * - `toSheet(raw)` drops a byte-order mark and one final line terminator,
 *   then normalizes (tabs to two spaces, CRLF and CR to LF). The sheet never
 *   holds a tab or a CR, so its own whole-value normalization never fires.
 * - `toFile(raw, sheet)` diffs the file's normalized lines against the
 *   sheet's lines. Matched lines keep their original bytes and terminators;
 *   inserted and changed lines use the file's main line ending. The byte-order
 *   mark and the final newline are restored. `toFile(raw, toSheet(raw))` is
 *   always `raw`.
 * - `sheetFiles(files)` wraps a folder store so sessions read and write sheet
 *   text while the file on disk is mapped faithfully.
 */

import { TAB_SPACES, normalizeText } from "../../page/index.ts";
import type { FilePath } from "../store/refs.ts";
import {
  FileUnreadableError,
  PageConflictError,
  type Page,
  type PageFiles,
  type Revision,
  type WriteResult,
} from "../store/types.ts";

const BOM = "﻿";

interface RawLine {
  /** The line's characters, without its terminator. */
  readonly content: string;
  /** "\r\n", "\n", "\r", or "" for a last line without one. */
  readonly eol: string;
}

interface ParsedFile {
  readonly bom: boolean;
  readonly lines: RawLine[];
  /** True when the last line ends with a terminator. */
  readonly finalNewline: boolean;
  /** The ending used for new and edited lines. */
  readonly mainEol: "\r\n" | "\n";
}

function parseFile(raw: string): ParsedFile {
  const bom = raw.startsWith(BOM);
  const body = bom ? raw.slice(1) : raw;
  const lines: RawLine[] = [];
  let i = 0;
  let crlf = 0;
  let lf = 0;
  while (i < body.length) {
    let j = i;
    while (j < body.length && body[j] !== "\n" && body[j] !== "\r") j++;
    let eol = "";
    if (body[j] === "\r") eol = body[j + 1] === "\n" ? "\r\n" : "\r";
    else if (body[j] === "\n") eol = "\n";
    if (eol === "\r\n") crlf++;
    else if (eol === "\n") lf++;
    lines.push({ content: body.slice(i, j), eol });
    i = j + eol.length;
  }
  const finalNewline = lines.length > 0 && lines[lines.length - 1].eol !== "";
  return { bom, lines, finalNewline, mainEol: crlf > lf ? "\r\n" : "\n" };
}

function normalizeLine(content: string): string {
  return content.replace(/\t/g, TAB_SPACES);
}

/** The text the sheet shows for a file's raw content. */
export function toSheet(raw: string): string {
  let body = raw.startsWith(BOM) ? raw.slice(1) : raw;
  if (body.endsWith("\r\n")) body = body.slice(0, -2);
  else if (body.endsWith("\n") || body.endsWith("\r")) body = body.slice(0, -1);
  return normalizeText(body);
}

/** Above this many differences, the middle of the diff is matched greedily. */
const MAX_EDIT_DISTANCE = 1000;

/**
 * Matched pairs [aIndex, bIndex] of a common subsequence of `a` and `b`, in
 * order. Myers' O(ND) diff, after stripping the common prefix and suffix;
 * falls back to a greedy forward match when the edit distance is very large.
 */
export function matchLines(a: readonly string[], b: readonly string[]): [number, number][] {
  const pairs: [number, number][] = [];
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) {
    pairs.push([start, start]);
    start++;
  }
  let endA = a.length;
  let endB = b.length;
  const suffix: [number, number][] = [];
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
    suffix.push([endA, endB]);
  }
  pairs.push(...myers(a, b, start, endA, start, endB));
  pairs.push(...suffix.reverse());
  return pairs;
}

function myers(
  a: readonly string[],
  b: readonly string[],
  a0: number,
  a1: number,
  b0: number,
  b1: number,
): [number, number][] {
  const n = a1 - a0;
  const m = b1 - b0;
  if (n === 0 || m === 0) return [];
  const max = Math.min(n + m, MAX_EDIT_DISTANCE);
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  let found = -1;
  for (let d = 0; d <= max && found < 0; d++) {
    trace.push(v.slice(offset - d - 1, offset + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? v[offset + k + 1] : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[a0 + x] === b[b0 + y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
  }
  if (found < 0) return greedy(a, b, a0, a1, b0, b1);

  // Backtrack through the saved frontiers. trace[d] holds v[k] for k in [-d-1, d+1].
  const out: [number, number][] = [];
  let x = n;
  let y = m;
  for (let d = found; d > 0; d--) {
    const prev = trace[d];
    const at = (k: number) => prev[k + d + 1];
    const k = x - y;
    const down = k === -d || (k !== d && at(k - 1) < at(k + 1));
    const prevK = down ? k + 1 : k - 1;
    const prevX = at(prevK);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      x--;
      y--;
      out.push([a0 + x, b0 + y]);
    }
    x = prevX;
    y = prevY;
  }
  while (x > 0 && y > 0) {
    x--;
    y--;
    out.push([a0 + x, b0 + y]);
  }
  return out.reverse();
}

function greedy(
  a: readonly string[],
  b: readonly string[],
  a0: number,
  a1: number,
  b0: number,
  b1: number,
): [number, number][] {
  const positions = new Map<string, number[]>();
  for (let i = a0; i < a1; i++) {
    const list = positions.get(a[i]);
    if (list) list.push(i);
    else positions.set(a[i], [i]);
  }
  const out: [number, number][] = [];
  let next = a0;
  for (let j = b0; j < b1; j++) {
    const list = positions.get(b[j]);
    if (!list) continue;
    const i = list.find((p) => p >= next);
    if (i === undefined) continue;
    out.push([i, j]);
    next = i + 1;
  }
  return out;
}

/** The file content to save for `sheet`, given the file's current `raw` content. */
export function toFile(raw: string, sheet: string): string {
  if (sheet === toSheet(raw)) return raw;
  const file = parseFile(raw);
  const target = sheet.split("\n");
  if (file.lines.length === 0) {
    // An empty file: write the sheet with LF endings and a final newline.
    return `${file.bom ? BOM : ""}${target.join("\n")}\n`;
  }
  const base = file.lines.map((l) => normalizeLine(l.content));
  const matchOf = new Int32Array(target.length).fill(-1);
  for (const [i, j] of matchLines(base, target)) matchOf[j] = i;

  const last = file.lines[file.lines.length - 1];
  let out = file.bom ? BOM : "";
  for (let j = 0; j < target.length; j++) {
    const i = matchOf[j];
    const line = i >= 0 ? file.lines[i] : null;
    out += line ? line.content : target[j];
    if (j < target.length - 1) out += line?.eol || file.mainEol;
    else if (file.finalNewline) out += last.eol;
  }
  return out;
}

/**
 * Wrap a folder store so sessions see sheet text. Revisions stay those of the
 * raw file, so a change on disk is still a conflict. A write whose mapped
 * content equals the file is skipped: an unedited file is never rewritten.
 */
export function sheetFiles(files: PageFiles<FilePath>): PageFiles<FilePath> {
  return {
    kind: files.kind,
    durable: files.durable,
    list: () => files.list(),
    async read(path: FilePath): Promise<Page<FilePath>> {
      const page = await files.read(path);
      return { ...page, text: toSheet(page.text) };
    },
    async create(path: FilePath, text: string): Promise<WriteResult<FilePath>> {
      return files.create(path, toFile("", text));
    },
    async write(path: FilePath, text: string, expected?: Revision | null): Promise<WriteResult<FilePath>> {
      let current: Page<FilePath>;
      try {
        current = await files.read(path);
      } catch (error) {
        if (expected != null && error instanceof FileUnreadableError) throw new PageConflictError(path, expected, null);
        throw error;
      }
      if (expected != null && current.revision !== expected) {
        throw new PageConflictError(path, expected, current.revision);
      }
      const raw = toFile(current.text, text);
      if (raw === current.text) {
        return { name: path, size: current.size, modifiedAt: current.modifiedAt, revision: current.revision };
      }
      // The inner store re-checks the revision under its lock.
      return files.write(path, raw, current.revision);
    },
  };
}
