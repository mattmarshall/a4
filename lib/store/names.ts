/**
 * Page names: validation, sanitizing, and unique-name selection.
 *
 * Rules: 1–80 characters after trimming and collapsing whitespace; none of
 * / \ : * ? " < > | or control characters; no leading period; unique ignoring
 * case. Names are file stems, so these rules keep them portable.
 */

import { InvalidPageNameError, type PageName, type PageStore } from "./types.ts";

export const MAX_NAME_LENGTH = 80;
export const DEFAULT_PAGE_NAME = "Untitled";

const FORBIDDEN = /[/\\:*?"<>|\u0000-\u001f\u007f]/;
const FORBIDDEN_GLOBAL = /[/\\:*?"<>|\u0000-\u001f\u007f]+/g;

function tidy(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

/** Validate user input as a page name. @throws InvalidPageNameError */
export function parsePageName(input: string): PageName {
  const name = tidy(input);
  if (name.length === 0) throw new InvalidPageNameError(input, "A page name can’t be empty.");
  if (name.length > MAX_NAME_LENGTH) {
    throw new InvalidPageNameError(input, `A page name can be at most ${MAX_NAME_LENGTH} characters.`);
  }
  if (FORBIDDEN.test(name)) {
    throw new InvalidPageNameError(input, "A page name can’t contain / \\ : * ? \" < > | or control characters.");
  }
  if (name.startsWith(".")) throw new InvalidPageNameError(input, "A page name can’t start with a period.");
  return name as PageName;
}

export function isValidPageName(input: string): boolean {
  try {
    parsePageName(input);
    return true;
  } catch {
    return false;
  }
}

/** Coerce arbitrary text into a valid page name. */
export function sanitizePageName(input: string, fallback: string = DEFAULT_PAGE_NAME): PageName {
  let name = tidy(input.replace(FORBIDDEN_GLOBAL, " ")).replace(/^\.+/, "").trim();
  if (name.length > MAX_NAME_LENGTH) name = name.slice(0, MAX_NAME_LENGTH).trimEnd();
  return name ? (name as PageName) : parsePageName(fallback);
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
    const candidate = `${base.slice(0, MAX_NAME_LENGTH - suffix.length).trimEnd()}${suffix}`;
    if (!lower.has(candidate.toLocaleLowerCase("en-US"))) return candidate as PageName;
  }
}

export async function availableName(store: PageStore, desired: string): Promise<PageName> {
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
