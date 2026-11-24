/**
 * The page storage contract.
 *
 * Two levels:
 * - `PageFiles<Id>`: the core every backend implements (list, read, create,
 *   write). The folder backend implements only this, keyed by `FilePath`.
 * - `PageStore`: a library backend (OPFS, key-value, memory), keyed by
 *   `PageName`, adding rename, trash, restore, and purge.
 *
 * Backends must pass the shared suites in `lib/store/testing/contract.ts`.
 * Application code depends only on this file.
 *
 * In the library, identity is the page name: a validated, branded string that
 * doubles as the file stem (`<name>.md`). A page's stored content is exactly
 * its text.
 */

declare const pageNameBrand: unique symbol;
declare const revisionBrand: unique symbol;
declare const trashIdBrand: unique symbol;

/** A validated page name (see `parsePageName`). Unique ignoring case. */
export type PageName = string & { readonly [pageNameBrand]: true };

/** Opaque content revision; equal text always has an equal revision. */
export type Revision = string & { readonly [revisionBrand]: true };

/** Identifier of a page in the trash. */
export type TrashId = string & { readonly [trashIdBrand]: true };

export type StoreKind = "opfs" | "local-storage" | "memory" | "folder";

export interface PageSummary<Id extends string = PageName> {
  readonly name: Id;
  /** UTF-8 size in bytes. */
  readonly size: number;
  /** Epoch milliseconds of the last write. */
  readonly modifiedAt: number;
}

export interface Page<Id extends string = PageName> extends PageSummary<Id> {
  readonly text: string;
  readonly revision: Revision;
}

export interface WriteResult<Id extends string = PageName> extends PageSummary<Id> {
  readonly revision: Revision;
}

export interface TrashEntry {
  readonly id: TrashId;
  /** The page's name when it was trashed. */
  readonly name: PageName;
  readonly size: number;
  /** Epoch milliseconds when the page was trashed. */
  readonly trashedAt: number;
}

/** The core every backend implements, keyed by `Id`. */
export interface PageFiles<Id extends string = PageName> {
  readonly kind: StoreKind;
  /** False when pages will not survive a reload (in-memory). */
  readonly durable: boolean;

  /** All pages, in no particular order. */
  list(): Promise<PageSummary<Id>[]>;
  /** @throws PageNotFoundError */
  read(name: Id): Promise<Page<Id>>;
  /** @throws PageExistsError, InvalidPageNameError */
  create(name: Id, text: string): Promise<WriteResult<Id>>;
  /**
   * Replace a page's text. With `expected`, fails unless the stored content
   * still has that revision.
   * @throws PageNotFoundError, PageConflictError
   */
  write(name: Id, text: string, expected?: Revision | null): Promise<WriteResult<Id>>;
}

/** A library backend: the core, keyed by page name, plus library operations. */
export interface PageStore extends PageFiles<PageName> {
  /** @throws PageExistsError (ignoring case), InvalidPageNameError */
  create(name: PageName, text: string): Promise<WriteResult>;
  /**
   * Rename a page, keeping its text. Renaming to a case variant of the same
   * name is allowed.
   * @throws PageNotFoundError, PageExistsError, InvalidPageNameError
   */
  rename(from: PageName, to: PageName): Promise<WriteResult>;
  /** Move a page to the trash. @throws PageNotFoundError */
  trash(name: PageName): Promise<TrashEntry>;
  listTrash(): Promise<TrashEntry[]>;
  /** Restore a trashed page under its name, or a unique variant of it. @throws PageNotFoundError */
  restore(id: TrashId): Promise<WriteResult>;
  /** Permanently delete a trashed page. @throws PageNotFoundError */
  purge(id: TrashId): Promise<void>;
}

// ---------------------------------------------------------------------------
// Typed errors

export type PageStoreErrorCode = "not-found" | "exists" | "invalid-name" | "conflict" | "unavailable" | "unreadable";

export class PageStoreError extends Error {
  readonly code: PageStoreErrorCode;
  constructor(code: PageStoreErrorCode, message: string) {
    super(message);
    this.name = "PageStoreError";
    this.code = code;
  }
}

export class PageNotFoundError extends PageStoreError {
  readonly page: string;
  constructor(page: string) {
    super("not-found", `No page named “${page}”.`);
    this.page = page;
  }
}

export class PageExistsError extends PageStoreError {
  readonly page: string;
  constructor(page: string) {
    super("exists", `A page named “${page}” already exists.`);
    this.page = page;
  }
}

export class InvalidPageNameError extends PageStoreError {
  readonly input: string;
  constructor(input: string, reason: string) {
    super("invalid-name", reason);
    this.input = input;
  }
}

export class PageConflictError extends PageStoreError {
  readonly page: string;
  readonly expected: Revision;
  readonly actual: Revision;
  constructor(page: string, expected: Revision, actual: Revision) {
    super("conflict", `“${page}” was changed elsewhere.`);
    this.page = page;
    this.expected = expected;
    this.actual = actual;
  }
}

export class StoreUnavailableError extends PageStoreError {
  constructor(message: string) {
    super("unavailable", message);
  }
}

/** Why a folder file can't be opened as a page. */
export type UnreadableReason = "too-large" | "not-utf8";

export class FileUnreadableError extends PageStoreError {
  readonly page: string;
  readonly reason: UnreadableReason;
  constructor(page: string, reason: UnreadableReason) {
    super("unreadable", reason === "too-large" ? `“${page}” is too large to open.` : `“${page}” isn’t UTF-8 text.`);
    this.page = page;
    this.reason = reason;
  }
}

export function isStoreError<C extends PageStoreErrorCode>(
  error: unknown,
  code: C,
): error is PageStoreError & { code: C } {
  return error instanceof PageStoreError && error.code === code;
}
