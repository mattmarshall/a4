/**
 * Library export: every page (not the trash) as `<folder>/<name>.md` in a zip.
 */

import { PAGE_EXTENSION } from "./store/opfs.ts";
import type { PageStore } from "./store/types.ts";
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
