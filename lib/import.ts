/**
 * Import pages from a zip archive.
 *
 * Every `.md` / `.txt` file becomes a page named after its basename. Existing
 * pages are never written: a file matching an existing page's name and text
 * is "unchanged"; a name clash with different text gets the next free name.
 * Pages created earlier in the same import count as existing.
 */

import { nextAvailableName, sanitizePageName } from "./store/names.ts";
import type { PageName, PageStore } from "./store/types.ts";
import { normalizeText } from "./text.ts";
import { DEFAULT_UNZIP_LIMITS, openZip, ZipError, type UnzipLimits } from "./unzip.ts";

/** Largest page file accepted (uncompressed bytes). */
export const MAX_PAGE_BYTES = 1024 * 1024;

const PAGE_EXTENSIONS = [".md", ".txt"];

export type SkipReason =
  | "macos-metadata"
  | "hidden"
  | "not-a-page"
  | "binary"
  | "encrypted"
  | "too-large"
  | "corrupt";

export interface ImportReport {
  /** Pages created, including renamed ones. */
  created: { path: string; name: PageName; renamedFrom: PageName | null }[];
  /** Files whose page already exists with identical text. */
  unchanged: { path: string; name: PageName }[];
  skipped: { path: string; reason: SkipReason }[];
}

const strictUtf8 = new TextDecoder("utf-8", { fatal: true });
const legacy = new TextDecoder("windows-1252");

/** Decode page bytes: UTF-8 (BOM stripped), falling back to Windows-1252. */
export function decodePageText(bytes: Uint8Array): string {
  let text: string;
  try {
    text = strictUtf8.decode(bytes);
  } catch {
    text = legacy.decode(bytes);
  }
  return normalizeText(text.replace(/^﻿/, ""));
}

function classify(path: string): { skip: SkipReason } | { stem: string } {
  const parts = path.split("/").filter(Boolean);
  const base = parts[parts.length - 1] ?? "";
  if (parts.some((p) => p === "__MACOSX")) return { skip: "macos-metadata" };
  if (base.startsWith(".")) return { skip: "hidden" };
  const lower = base.toLowerCase();
  const ext = PAGE_EXTENSIONS.find((e) => lower.endsWith(e));
  if (!ext) return { skip: "not-a-page" };
  return { stem: base.slice(0, -ext.length) };
}

/** Import every page file in `bytes` into `store`. @throws ZipError for archive-level problems. */
export async function importZip(
  store: PageStore,
  bytes: Uint8Array,
  limits: UnzipLimits = DEFAULT_UNZIP_LIMITS,
): Promise<ImportReport> {
  const entries = openZip(bytes, limits);
  const report: ImportReport = { created: [], unchanged: [], skipped: [] };

  const existing = new Map<string, PageName>();
  for (const page of await store.list()) existing.set(page.name.toLocaleLowerCase("en-US"), page.name);
  const textCache = new Map<PageName, string>();
  const textOf = async (name: PageName) => {
    if (!textCache.has(name)) textCache.set(name, (await store.read(name)).text);
    return textCache.get(name) as string;
  };

  for (const entry of entries) {
    if (entry.isDirectory) continue;
    const kind = classify(entry.name);
    if ("skip" in kind) {
      report.skipped.push({ path: entry.name, reason: kind.skip });
      continue;
    }
    if (entry.encrypted) {
      report.skipped.push({ path: entry.name, reason: "encrypted" });
      continue;
    }
    if (entry.size > MAX_PAGE_BYTES) {
      report.skipped.push({ path: entry.name, reason: "too-large" });
      continue;
    }
    let data: Uint8Array;
    try {
      data = await entry.read();
    } catch (error) {
      if (!(error instanceof ZipError)) throw error;
      report.skipped.push({ path: entry.name, reason: error.code === "encrypted" ? "encrypted" : "corrupt" });
      continue;
    }
    if (data.includes(0)) {
      report.skipped.push({ path: entry.name, reason: "binary" });
      continue;
    }

    const text = decodePageText(data);
    const wanted = sanitizePageName(kind.stem);
    const clash = existing.get(wanted.toLocaleLowerCase("en-US"));
    if (clash && (await textOf(clash)) === text) {
      report.unchanged.push({ path: entry.name, name: clash });
      continue;
    }
    // Same text under a renamed copy made earlier in this import is also unchanged.
    let duplicate: PageName | undefined;
    for (const made of report.created) {
      if (made.renamedFrom && made.renamedFrom.toLocaleLowerCase("en-US") === wanted.toLocaleLowerCase("en-US")) {
        if ((await textOf(made.name)) === text) duplicate = made.name;
      }
    }
    if (duplicate) {
      report.unchanged.push({ path: entry.name, name: duplicate });
      continue;
    }

    const name = clash ? nextAvailableName(wanted, existing.values()) : wanted;
    const result = await store.create(name, text);
    existing.set(result.name.toLocaleLowerCase("en-US"), result.name);
    textCache.set(result.name, text);
    report.created.push({ path: entry.name, name: result.name, renamedFrom: clash ? wanted : null });
  }
  return report;
}

const REASON_LABEL: Record<SkipReason, string> = {
  "macos-metadata": "macOS metadata",
  hidden: "hidden",
  "not-a-page": "not .md or .txt",
  binary: "binary",
  encrypted: "encrypted",
  "too-large": "over 1 MB",
  corrupt: "damaged",
};

function plural(n: number, word: string): string {
  return `${n.toLocaleString("en-US")} ${word}${n === 1 ? "" : "s"}`;
}

/** One-line summary, e.g. "Imported 3 pages (1 renamed), 2 unchanged, 4 skipped (…)." */
export function describeImport(report: ImportReport): string {
  const renamed = report.created.filter((c) => c.renamedFrom).length;
  const parts = [`Imported ${plural(report.created.length, "page")}${renamed ? ` (${renamed} renamed)` : ""}`];
  if (report.unchanged.length) parts.push(`${report.unchanged.length.toLocaleString("en-US")} unchanged`);
  if (report.skipped.length) {
    const byReason = new Map<SkipReason, number>();
    for (const s of report.skipped) byReason.set(s.reason, (byReason.get(s.reason) ?? 0) + 1);
    const detail = [...byReason.entries()].map(([r, n]) => `${n} ${REASON_LABEL[r]}`).join(", ");
    parts.push(`${report.skipped.length.toLocaleString("en-US")} skipped (${detail})`);
  }
  return `${parts.join(", ")}.`;
}
