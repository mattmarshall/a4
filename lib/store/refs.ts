/**
 * Page references: a library page (by name) or a folder file (by path).
 *
 * A `FilePath` is a validated, relative POSIX path inside the open folder,
 * case-sensitive like the folder's own entries. References are remembered as
 * scalar strings: a bare page name for a library page (as before this change)
 * or `file:<path>` for a file. Page names can't contain ":", so the prefix
 * never collides with a library name.
 */

import { MAX_NAME_LENGTH, parsePageName, sanitizePageName } from "./names.ts";
import { InvalidPageNameError, isStoreError, type IdCodec, type PageName } from "./types.ts";

declare const filePathBrand: unique symbol;

/** A validated relative path to a Markdown file in a folder. */
export type FilePath = string & { readonly [filePathBrand]: true };

export const MAX_PATH_LENGTH = 512;
export const FILE_EXTENSIONS = [".md", ".mdc"] as const;

// Control characters and backslashes are never part of a path we accept.
// biome-ignore lint/suspicious/noControlCharactersInRegex: this regex exists to reject control characters.
const FORBIDDEN_PATH = /[\\\u0000-\u001f\u007f]/;

/** True when `name` ends in one of the editable extensions (ignoring case). */
export function hasFileExtension(name: string): boolean {
  const lower = name.toLowerCase();
  return FILE_EXTENSIONS.some((ext) => lower.endsWith(ext) && lower.length > ext.length);
}

/** Validate a relative file path. @throws InvalidPageNameError */
export function parseFilePath(input: string): FilePath {
  const path = String(input ?? "");
  const fail = (reason: string): never => {
    throw new InvalidPageNameError(path, reason);
  };
  if (path.length === 0) fail("A file path can’t be empty.");
  if (path.length > MAX_PATH_LENGTH) fail(`A file path can be at most ${MAX_PATH_LENGTH} characters.`);
  if (FORBIDDEN_PATH.test(path)) fail("A file path can’t contain \\ or control characters.");
  if (path.startsWith("/")) fail("A file path must be relative to the folder.");
  const segments = path.split("/");
  for (const segment of segments) {
    if (segment === "") fail("A file path can’t have empty parts.");
    if (segment === "." || segment === "..") fail("A file path must stay inside the folder.");
    if (segment.trim() !== segment) fail("Parts of a file path can’t start or end with a space.");
  }
  if (!hasFileExtension(segments[segments.length - 1])) fail("Only .md and .mdc files can be opened.");
  return path as FilePath;
}

/** Like `parseFilePath`, but null instead of throwing. */
export function tryParseFilePath(input: string): FilePath | null {
  try {
    return parseFilePath(input);
  } catch (error) {
    if (isStoreError(error, "invalid-name")) return null;
    throw error;
  }
}

/** File paths as stored keys: an invalid stored path is skipped. */
export const filePathCodec: IdCodec<FilePath> = {
  parse: tryParseFilePath,
  format: (path) => path,
};

/** The last segment of a path ("AGENTS.md" for "docs/AGENTS.md"). */
export function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

export type PageRef =
  | { readonly kind: "library"; readonly name: PageName }
  | { readonly kind: "file"; readonly path: FilePath };

export function libraryRef(name: PageName): PageRef {
  return { kind: "library", name };
}

export function fileRef(path: FilePath): PageRef {
  return { kind: "file", path };
}

const FILE_PREFIX = "file:";

/** The scalar form remembered in storage. */
export function encodeRef(ref: PageRef | null): string {
  if (!ref) return "";
  return ref.kind === "library" ? ref.name : `${FILE_PREFIX}${ref.path}`;
}

/** Parse a remembered reference; null when empty or invalid. */
export function decodeRef(value: string | null | undefined): PageRef | null {
  if (!value) return null;
  try {
    if (value.startsWith(FILE_PREFIX)) return fileRef(parseFilePath(value.slice(FILE_PREFIX.length)));
    return libraryRef(parsePageName(value));
  } catch (error) {
    if (isStoreError(error, "invalid-name")) return null;
    throw error;
  }
}

/** Remembered references, in the scalar form of `encodeRef`. */
export const pageRefCodec: IdCodec<PageRef> = {
  parse: decodeRef,
  format: encodeRef,
};

export function sameRef(a: PageRef | null, b: PageRef | null): boolean {
  if (!a || !b) return a === b;
  if (a.kind === "library") return b.kind === "library" && a.name === b.name;
  return b.kind === "file" && a.path === b.path;
}

/** What the UI shows for a reference: the page name or the file path. */
export function refLabel(ref: PageRef): string {
  return ref.kind === "library" ? ref.name : ref.path;
}

/**
 * The library page name for a copy of a file: the path with "/" shown as
 * " › " and a leading period dropped, then `suffix`. When too long, leading
 * folders give way to "… › " so the file name and the suffix survive.
 */
export function fileCopyName(path: string, suffix = ""): PageName {
  const budget = MAX_NAME_LENGTH - suffix.length;
  let segments = path.replace(/^\.+/, "").split("/");
  let base = segments.join(" › ");
  while (base.length > budget && segments.length > 1) {
    segments = segments.slice(1);
    base = `… › ${segments.join(" › ")}`;
  }
  if (base.length > budget) base = base.slice(base.length - budget);
  return sanitizePageName(`${base}${suffix}`);
}

/** The name for a library copy of the page `ref` refers to. */
export function copyNameFor(ref: PageRef, suffix = ""): PageName {
  return ref.kind === "library" ? sanitizePageName(`${ref.name}${suffix}`) : fileCopyName(ref.path, suffix);
}
