/**
 * Page names: validation, sanitizing, and unique-name selection.
 *
 * Rules: 1–80 characters after trimming and collapsing whitespace; none of
 * / \ : * ? " < > | or control characters; no leading period; unique ignoring
 * case. Names are file stems, so these rules keep them portable.
 */

import { InvalidPageNameError, type IdCodec, type PageName, type PageSummary } from "./types.ts";

export const MAX_NAME_LENGTH = 80;
export const DEFAULT_PAGE_NAME = "Untitled";

// biome-ignore lint/suspicious/noControlCharactersInRegex: page names must not contain control characters.
const FORBIDDEN = /[/\\:*?"<>|\u0000-\u001f\u007f]/;
// biome-ignore lint/suspicious/noControlCharactersInRegex: page names must not contain control characters.
const FORBIDDEN_GLOBAL = /[/\\:*?"<>|\u0000-\u001f\u007f]+/g;

function tidy(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

/** The first `max` UTF-16 units of `s`, never ending inside a surrogate pair. */
function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

/** Validate user input as a page name. @throws InvalidPageNameError */
export function parsePageName(input: string): PageName {
  const name = tidy(input);
  if (name.length === 0) throw new InvalidPageNameError(input, "A page name can’t be empty.");
  if (name.length > MAX_NAME_LENGTH) {
    throw new InvalidPageNameError(input, `A page name can be at most ${MAX_NAME_LENGTH} characters.`);
  }
  if (FORBIDDEN.test(name)) {
    throw new InvalidPageNameError(input, 'A page name can’t contain / \\ : * ? " < > | or control characters.');
  }
  if (name.startsWith(".")) throw new InvalidPageNameError(input, "A page name can’t start with a period.");
  if (!name.isWellFormed())
    throw new InvalidPageNameError(input, "A page name can’t contain an unpaired surrogate character.");
  return name as PageName;
}

/**
 * A name read back from storage. Pages already stored keep their names, even
 * if today's rules would reject them; only an empty stem (a file named ".md")
 * is skipped.
 */
export function storedPageName(stem: string): PageName | null {
  return stem.length > 0 ? (stem as PageName) : null;
}

/** Page names as stored keys and file stems, read back like `storedPageName`. */
export const pageNameCodec: IdCodec<PageName> = {
  parse: storedPageName,
  format: (name) => name,
};

export function isValidPageName(input: string): boolean {
  try {
    parsePageName(input);
    return true;
  } catch {
    return false;
  }
}

/** Coerce arbitrary text into a valid page name; the result always parses. */
export function sanitizePageName(input: string, fallback: string = DEFAULT_PAGE_NAME): PageName {
  let name = tidy(input.toWellFormed().replace(FORBIDDEN_GLOBAL, " "));
  // Leading periods and spaces in any mix (". .x" → "x").
  name = name.replace(/^[.\s]+/, "");
  name = truncate(name, MAX_NAME_LENGTH).trimEnd();
  try {
    return parsePageName(name);
  } catch {
    return parsePageName(fallback);
  }
}

/** A page name from the first non-blank line of `text`. */
export function nameFromText(text: string, fallback: string = DEFAULT_PAGE_NAME): PageName {
  const first = text.split("\n").find((l) => l.trim().length > 0) ?? "";
  return sanitizePageName(first, fallback);
}

export function sameName(a: string, b: string): boolean {
  return a.toLocaleLowerCase("en-US") === b.toLocaleLowerCase("en-US");
}

/** `desired`, or `desired 2`, `desired 3`, … — whichever is free (ignoring case). */
export function nextAvailableName(desired: string, taken: Iterable<string>): PageName {
  const base = sanitizePageName(desired);
  const lower = new Set([...taken].map((n) => n.toLocaleLowerCase("en-US")));
  if (!lower.has(base.toLocaleLowerCase("en-US"))) return base;
  for (let i = 2; ; i++) {
    const suffix = ` ${i}`;
    const candidate = parsePageName(`${truncate(base, MAX_NAME_LENGTH - suffix.length).trimEnd()}${suffix}`);
    if (!lower.has(candidate.toLocaleLowerCase("en-US"))) return candidate;
  }
}

export async function availableName(
  store: { list(): Promise<readonly PageSummary<string>[]> },
  desired: string,
): Promise<PageName> {
  const pages = await store.list();
  return nextAvailableName(
    desired,
    pages.map((p) => p.name),
  );
}

/** "2026-11-23 16:05" in local time, for conflict and recovery copies. */
export function stamp(date: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}.${p(date.getMinutes())}`;
}
