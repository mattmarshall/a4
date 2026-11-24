/**
 * Library export: every page (not the trash) as `<folder>/<name>.md` in a zip.
 */

import { PAGE_EXTENSION } from "../persist/store/names.ts";
import type { PageStore } from "../persist/store/types.ts";
import { createZip } from "./zip.ts";

export interface LibraryArchive {
  bytes: Uint8Array;
  /** e.g. "a4-pages-2026-11-23.zip" */
  fileName: string;
  /** e.g. "a4-pages-2026-11-23" */
  folder: string;
  count: number;
}

/** Local calendar date as YYYY-MM-DD. */
export function localDate(date: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

export async function buildLibraryArchive(store: PageStore, date: Date = new Date()): Promise<LibraryArchive> {
  const folder = `a4-pages-${localDate(date)}`;
  const summaries = [...(await store.list())].sort((a, b) => a.name.localeCompare(b.name, "en-US"));
  const entries = [];
  for (const summary of summaries) {
    const page = await store.read(summary.name);
    entries.push({ name: `${folder}/${page.name}${PAGE_EXTENSION}`, data: page.text, modifiedAt: page.modifiedAt });
  }
  return { bytes: await createZip(entries), fileName: `${folder}.zip`, folder, count: entries.length };
}

/**
 * Download-friendly slug from the first non-blank line: lowercase,
 * hyphen-separated ASCII, at most 48 characters.
 */
export function slugFromText(text: string, fallback = "a4-page"): string {
  const first = text.split("\n").find((l) => l.trim().length > 0) ?? "";
  const slug = first
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
  return slug || fallback;
}
