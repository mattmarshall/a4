/**
 * The served library's wire (proto/a4/v1/store.proto, README "Served
 * library"), written once for both sides: `serve.ts` answers it over a
 * PageStore, and `remote.ts` calls it.
 *
 * - The method names and each method's request and response types are
 *   derived from the generated `PageStoreService`, so a method the proto
 *   adds doesn't compile until the server's table handles it.
 * - Each conversion between a store type and its message is written here,
 *   beside its inverse. The client's direction checks what it reads: a name,
 *   revision, or trash id that doesn't parse is StoreUnavailableError
 *   ("bad-answer").
 * - Each store error crosses as an `a4.v1.StoreFailure` with its code, its
 *   HTTP status, and a typed detail, and comes back as the same class.
 */

import {
  create,
  type DescMessage,
  fromBinary,
  type MessageInitShape,
  type MessageShape,
  toBinary,
} from "@bufbuild/protobuf";
import type { GenService } from "@bufbuild/protobuf/codegenv2";
import {
  type LibraryInfo,
  PageStoreService,
  StoreErrorCode,
  type StoredPage,
  type StoredPageSchema,
  type StoredPageSummary,
  type StoredPageSummarySchema,
  type StoredTrashEntry,
  type StoredTrashEntrySchema,
  type StoredWrite,
  type StoredWriteSchema,
  type StoreFailure,
  type StoreFailureSchema,
  UnreadableReason as WireUnreadableReason,
} from "../../gen/a4/v1/store_pb.js";
import { assertNever } from "../../page/index.ts";
import { storedPageName } from "./names.ts";
import { parseRevision } from "./revision.ts";
import { parseTrashId } from "./trash-ids.ts";
import {
  FileUnreadableError,
  InvalidPageNameError,
  InvalidTextError,
  type Page,
  PageConflictError,
  PageExistsError,
  type PageName,
  PageNotFoundError,
  type PageStoreError,
  type PageStoreErrorCode,
  type PageSummary,
  type Revision,
  type StoreErrorMap,
  StoreUnavailableError,
  type TrashEntry,
  type WriteResult,
} from "./types.ts";

// ---------------------------------------------------------------------------
// Methods

type Methods = typeof PageStoreService extends GenService<infer T> ? T : never;

/** A method of `PageStoreService`, by its name in the generated service ("readPage"). */
export type StoreMethod = keyof Methods & string;
export type StoreRequest<K extends StoreMethod> = MessageShape<Methods[K]["input"]>;
export type StoreRequestInit<K extends StoreMethod> = MessageInitShape<Methods[K]["input"]>;
export type StoreResponse<K extends StoreMethod> = MessageShape<Methods[K]["output"]>;
export type StoreResponseInit<K extends StoreMethod> = MessageInitShape<Methods[K]["output"]>;

/** The server: one handler for every method. Leaving one out is a type error. */
export type StoreHandlers = {
  readonly [K in StoreMethod]: (request: StoreRequest<K>) => Promise<StoreResponseInit<K>>;
};

/** The protocol version both sides speak. The app shows a served library only when it speaks this one. */
export const STORE_PROTOCOL = 1;

/** The path prefix of every call: `/a4.v1.PageStoreService/`, then the method's wire name ("ReadPage"). */
export const STORE_PATH = `/${PageStoreService.typeName}/`;

// Encoding and decoding, typed by method. TypeScript widens a generic method's
// schema to the union of every method's, so each of these asserts the type the
// descriptor indexed by that same method produces: the only casts on the wire.

function descOf(method: StoreMethod): { readonly input: DescMessage; readonly output: DescMessage } {
  return PageStoreService.method[method];
}

/** A request's bytes, as the client sends them. */
export function encodeRequest<K extends StoreMethod>(method: K, request: StoreRequestInit<K>): Uint8Array<ArrayBuffer> {
  const { input } = descOf(method);
  return toBinary(input, create(input, request as MessageInitShape<DescMessage>));
}

/** A request, as the server reads it. Throws when the bytes aren't this method's request. */
export function decodeRequest<K extends StoreMethod>(method: K, bytes: Uint8Array): StoreRequest<K> {
  return fromBinary(descOf(method).input, bytes) as StoreRequest<K>;
}

/** A response's bytes, as the server sends them. */
export function encodeResponse<K extends StoreMethod>(
  method: K,
  response: StoreResponseInit<K>,
): Uint8Array<ArrayBuffer> {
  const { output } = descOf(method);
  return toBinary(output, create(output, response as MessageInitShape<DescMessage>));
}

/** A response, as the client reads it. Throws when the bytes aren't this method's response. */
export function decodeResponse<K extends StoreMethod>(method: K, bytes: Uint8Array): StoreResponse<K> {
  return fromBinary(descOf(method).output, bytes) as StoreResponse<K>;
}

/** A method's name on the wire, as the URL carries it ("ReadPage"). */
export function wireName(method: StoreMethod): string {
  return PageStoreService.method[method].name;
}

const BY_WIRE_NAME = new Map(
  (Object.keys(PageStoreService.method) as StoreMethod[]).map((method) => [wireName(method), method]),
);

/** The method a URL names, or null for one this protocol doesn't have. */
export function methodByWireName(name: string): StoreMethod | null {
  return BY_WIRE_NAME.get(name) ?? null;
}

// ---------------------------------------------------------------------------
// Conversions: each store type to its message (the server), and back (the client)

function badAnswer(what: string): StoreUnavailableError {
  return new StoreUnavailableError(`a4 serve sent ${what} A4 can’t read.`, "bad-answer");
}

function nameFrom(value: string): PageName {
  const parsed = storedPageName(value);
  if (!parsed) throw badAnswer(`a page name (“${value}”)`);
  return parsed;
}

function revisionFrom(value: string): Revision {
  const parsed = parseRevision(value);
  if (!parsed) throw badAnswer("a revision");
  return parsed;
}

function present<T>(message: T | undefined): T {
  if (message === undefined) throw badAnswer("an empty answer");
  return message;
}

export const summaryWire = {
  to: (p: PageSummary): MessageInitShape<typeof StoredPageSummarySchema> => ({
    name: p.name,
    size: BigInt(p.size),
    modifiedAt: p.modifiedAt,
  }),
  from: (m: StoredPageSummary): PageSummary => ({
    name: nameFrom(m.name),
    size: Number(m.size),
    modifiedAt: m.modifiedAt,
  }),
};

export const pageWire = {
  to: (p: Page): MessageInitShape<typeof StoredPageSchema> => ({
    name: p.name,
    text: p.text,
    revision: p.revision,
    size: BigInt(p.size),
    modifiedAt: p.modifiedAt,
  }),
  from: (m: StoredPage | undefined): Page => {
    const p = present(m);
    return {
      name: nameFrom(p.name),
      text: p.text,
      revision: revisionFrom(p.revision),
      size: Number(p.size),
      modifiedAt: p.modifiedAt,
    };
  },
};

export const writeWire = {
  to: (w: WriteResult): MessageInitShape<typeof StoredWriteSchema> => ({
    name: w.name,
    revision: w.revision,
    size: BigInt(w.size),
    modifiedAt: w.modifiedAt,
  }),
  from: (m: StoredWrite | undefined): WriteResult => {
    const w = present(m);
    return {
      name: nameFrom(w.name),
      revision: revisionFrom(w.revision),
      size: Number(w.size),
      modifiedAt: w.modifiedAt,
    };
  },
};

export const trashWire = {
  to: (t: TrashEntry): MessageInitShape<typeof StoredTrashEntrySchema> => ({
    id: t.id,
    name: t.name,
    size: BigInt(t.size),
    trashedAt: t.trashedAt,
  }),
  from: (m: StoredTrashEntry | undefined): TrashEntry => {
    const t = present(m);
    const parsed = parseTrashId(t.id);
    if (!parsed) throw badAnswer("a trash entry");
    return { id: parsed.id, name: nameFrom(t.name), size: Number(t.size), trashedAt: t.trashedAt };
  },
};

// ---------------------------------------------------------------------------
// The library

/** A library's id: 22 base64url characters (16 random bytes), kept in `<folder>/.a4-library`. */
export type LibraryId = string;

const LIBRARY_ID = /^[A-Za-z0-9_-]{22}$/;

export function isLibraryId(text: string): text is LibraryId {
  return LIBRARY_ID.test(text);
}

/**
 * The library a server named, once its protocol is this app's: an older
 * protocol is "older-server", a newer one "newer-server", and a missing or
 * malformed id "bad-answer".
 */
export function libraryFrom(info: LibraryInfo | undefined, address: string): LibraryId {
  const library = present(info);
  if (library.protocol < STORE_PROTOCOL) throw olderServer(address);
  if (library.protocol > STORE_PROTOCOL) {
    throw new StoreUnavailableError(`a4 serve at ${address} is newer than this A4.`, "newer-server");
  }
  if (!isLibraryId(library.id)) throw badAnswer("a library id");
  return library.id;
}

/** A server that speaks an older protocol, or none that knows GetLibrary. */
export function olderServer(address: string): StoreUnavailableError {
  return new StoreUnavailableError(`a4 serve at ${address} is older than this A4.`, "older-server");
}

// ---------------------------------------------------------------------------
// Errors

/** Each store error's code on the wire and its HTTP status. */
const STATUS: Readonly<Record<PageStoreErrorCode, { readonly code: StoreErrorCode; readonly status: number }>> = {
  "not-found": { code: StoreErrorCode.NOT_FOUND, status: 404 },
  exists: { code: StoreErrorCode.EXISTS, status: 409 },
  "invalid-name": { code: StoreErrorCode.INVALID_NAME, status: 422 },
  "invalid-text": { code: StoreErrorCode.INVALID_TEXT, status: 422 },
  conflict: { code: StoreErrorCode.CONFLICT, status: 409 },
  unavailable: { code: StoreErrorCode.UNAVAILABLE, status: 503 },
  unreadable: { code: StoreErrorCode.UNREADABLE, status: 422 },
};

/** A store error, as the class its code stands for. */
type AnyStoreError = StoreErrorMap[PageStoreErrorCode];

/**
 * A store error as the server sends it: its status and its failure, with the
 * typed detail and (for tabs loaded before the detail) the deprecated flat
 * fields.
 */
export function failureOf(error: PageStoreError): {
  readonly status: number;
  readonly failure: MessageInitShape<typeof StoreFailureSchema>;
} {
  // Only the classes in StoreErrorMap make a PageStoreError, so its code names its class.
  const typed = error as AnyStoreError;
  const { code, status } = STATUS[typed.code];
  const base = { code, message: typed.message };
  switch (typed.code) {
    case "not-found":
    case "exists":
    case "invalid-text":
      return { status, failure: { ...base, page: typed.page } };
    case "invalid-name":
      return { status, failure: { ...base, page: typed.input } };
    case "conflict": {
      const actual = typed.actual === null ? {} : { actual: typed.actual };
      return {
        status,
        failure: {
          ...base,
          page: typed.page,
          expected: typed.expected,
          ...actual,
          detail: { case: "conflict", value: { expected: typed.expected, ...actual } },
        },
      };
    }
    case "unreadable":
      return {
        status,
        failure: {
          ...base,
          page: typed.page,
          reason: typed.reason,
          detail: {
            case: "unreadable",
            value: {
              reason: typed.reason === "too-large" ? WireUnreadableReason.TOO_LARGE : WireUnreadableReason.NOT_UTF8,
            },
          },
        },
      };
    case "unavailable":
      return { status, failure: base };
    default:
      return assertNever(typed);
  }
}

/** The store error a failure stands for, as the class the server threw. */
export function errorFrom(failure: StoreFailure): PageStoreError {
  switch (failure.code) {
    case StoreErrorCode.NOT_FOUND:
      return new PageNotFoundError(failure.page);
    case StoreErrorCode.EXISTS:
      return new PageExistsError(failure.page);
    case StoreErrorCode.INVALID_NAME:
      return new InvalidPageNameError(failure.page, failure.message);
    case StoreErrorCode.INVALID_TEXT:
      return new InvalidTextError(failure.page);
    case StoreErrorCode.CONFLICT: {
      if (failure.detail.case !== "conflict") return badAnswer("a conflict");
      const { expected, actual } = failure.detail.value;
      return new PageConflictError(
        failure.page,
        revisionFrom(expected),
        actual === undefined ? null : parseRevision(actual),
      );
    }
    case StoreErrorCode.UNREADABLE: {
      if (failure.detail.case !== "unreadable") return badAnswer("an unreadable file");
      const reason = failure.detail.value.reason;
      if (reason === WireUnreadableReason.TOO_LARGE) return new FileUnreadableError(failure.page, "too-large");
      if (reason === WireUnreadableReason.NOT_UTF8) return new FileUnreadableError(failure.page, "not-utf8");
      return badAnswer("an unreadable file");
    }
    case StoreErrorCode.UNAVAILABLE:
      return new StoreUnavailableError(failure.message || "a4 serve couldn’t do that.");
    default:
      return badAnswer("an error");
  }
}
