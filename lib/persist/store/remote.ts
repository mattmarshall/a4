/**
 * A PageStore served by `a4 serve` (README, "Served library"): each operation
 * is one POST to `<base>/a4.v1.PageStoreService/<Method>` with the library's
 * token, and protobuf bodies both ways (proto/a4/v1/store.proto). A store error
 * comes back as an `a4.v1.StoreFailure` and is thrown as the same typed error
 * the browser's own store throws, so autosave, conflicts, and retries work as
 * they do there. A request that can't reach the server, or that the server
 * refuses, is StoreUnavailableError.
 */

import {
  create,
  type DescMessage,
  fromBinary,
  type MessageInitShape,
  type MessageShape,
  toBinary,
} from "@bufbuild/protobuf";
import {
  CreatePageRequestSchema,
  CreatePageResponseSchema,
  CreateUniquePageRequestSchema,
  CreateUniquePageResponseSchema,
  ListPagesRequestSchema,
  ListPagesResponseSchema,
  ListTrashRequestSchema,
  ListTrashResponseSchema,
  PurgePageRequestSchema,
  PurgePageResponseSchema,
  ReadPageRequestSchema,
  ReadPageResponseSchema,
  RenamePageRequestSchema,
  RenamePageResponseSchema,
  RestorePageRequestSchema,
  RestorePageResponseSchema,
  StoreErrorCode,
  type StoredTrashEntry,
  type StoredWrite,
  type StoreFailure,
  StoreFailureSchema,
  TrashPageRequestSchema,
  TrashPageResponseSchema,
  WritePageRequestSchema,
  WritePageResponseSchema,
} from "../../gen/a4/v1/store_pb.js";
import { storedPageName } from "./names.ts";
import { parseRevision } from "./revision.ts";
import { parseTrashId } from "./trash-ids.ts";
import {
  assertStorableText,
  FileUnreadableError,
  InvalidPageNameError,
  InvalidTextError,
  type Page,
  PageConflictError,
  PageExistsError,
  type PageName,
  PageNotFoundError,
  type PageStore,
  type PageSummary,
  type Revision,
  StoreUnavailableError,
  type TrashEntry,
  type TrashId,
  type WriteResult,
} from "./types.ts";

export interface RemotePageStoreOptions {
  /** The server, such as "http://127.0.0.1:4320". */
  readonly base: string;
  readonly token: string;
  readonly fetch?: typeof fetch;
}

const PATH = "/a4.v1.PageStoreService/";

function name(value: string): PageName {
  const parsed = storedPageName(value);
  if (!parsed) throw new StoreUnavailableError(`a4 serve sent a page name A4 can’t use: “${value}”.`);
  return parsed;
}

function revision(value: string): Revision {
  const parsed = parseRevision(value);
  if (!parsed) throw new StoreUnavailableError("a4 serve sent a revision A4 can’t read.");
  return parsed;
}

function writeResult(w: StoredWrite | undefined): WriteResult {
  if (!w) throw new StoreUnavailableError("a4 serve sent an empty answer.");
  return { name: name(w.name), revision: revision(w.revision), size: Number(w.size), modifiedAt: w.modifiedAt };
}

function trashEntry(t: StoredTrashEntry | undefined): TrashEntry {
  const parsed = t ? parseTrashId(t.id) : null;
  if (!t || !parsed) throw new StoreUnavailableError("a4 serve sent a trash entry A4 can’t read.");
  return { id: parsed.id, name: name(t.name), size: Number(t.size), trashedAt: t.trashedAt };
}

/** The typed error a StoreFailure stands for. */
function errorOf(failure: StoreFailure): Error {
  switch (failure.code) {
    case StoreErrorCode.NOT_FOUND:
      return new PageNotFoundError(failure.page);
    case StoreErrorCode.EXISTS:
      return new PageExistsError(failure.page);
    case StoreErrorCode.INVALID_NAME:
      return new InvalidPageNameError(failure.page, failure.message);
    case StoreErrorCode.INVALID_TEXT:
      return new InvalidTextError(failure.page);
    case StoreErrorCode.CONFLICT:
      return new PageConflictError(
        failure.page,
        revision(failure.expected),
        failure.actual === undefined ? null : parseRevision(failure.actual),
      );
    case StoreErrorCode.UNREADABLE:
      return new FileUnreadableError(failure.page, failure.reason === "too-large" ? "too-large" : "not-utf8");
    default:
      return new StoreUnavailableError(failure.message || "a4 serve couldn’t do that.");
  }
}

export class RemotePageStore implements PageStore {
  readonly kind = "served" as const;
  readonly durable = true;
  /** The server this store talks to, as "127.0.0.1:4320". */
  readonly address: string;
  readonly #base: string;
  readonly #token: string;
  readonly #fetch: typeof fetch;

  constructor(options: RemotePageStoreOptions) {
    this.#base = options.base.replace(/\/+$/, "");
    this.address = new URL(this.#base).host;
    this.#token = options.token;
    this.#fetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  }

  async #call<I extends DescMessage, O extends DescMessage>(
    method: string,
    input: I,
    output: O,
    request: MessageInitShape<I>,
  ): Promise<MessageShape<O>> {
    let response: Response;
    try {
      response = await this.#fetch(`${this.#base}${PATH}${method}`, {
        method: "POST",
        headers: { "content-type": "application/proto", authorization: `Bearer ${this.#token}` },
        body: toBinary(input, create(input, request)),
        credentials: "omit",
        referrerPolicy: "no-referrer",
      });
    } catch {
      throw new StoreUnavailableError(`a4 serve isn’t running at ${this.address}.`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer().catch(() => new ArrayBuffer(0)));
    if (response.ok) {
      try {
        return fromBinary(output, bytes);
      } catch {
        throw new StoreUnavailableError("a4 serve sent an answer A4 can’t read.");
      }
    }
    if (response.status === 401 || response.status === 403) {
      throw new StoreUnavailableError(
        `a4 serve at ${this.address} refused this request: the token or this page’s address doesn’t match.`,
      );
    }
    let failure: StoreFailure | null = null;
    try {
      failure = bytes.length > 0 ? fromBinary(StoreFailureSchema, bytes) : null;
    } catch {
      failure = null;
    }
    if (failure && failure.code !== StoreErrorCode.UNSPECIFIED) throw errorOf(failure);
    throw new StoreUnavailableError(`a4 serve at ${this.address} answered ${response.status}.`);
  }

  async list(): Promise<PageSummary[]> {
    const r = await this.#call("ListPages", ListPagesRequestSchema, ListPagesResponseSchema, {});
    return r.pages.map((p) => ({ name: name(p.name), size: Number(p.size), modifiedAt: p.modifiedAt }));
  }

  async read(page: PageName): Promise<Page> {
    const r = await this.#call("ReadPage", ReadPageRequestSchema, ReadPageResponseSchema, { name: page });
    const p = r.page;
    if (!p) throw new StoreUnavailableError("a4 serve sent an empty answer.");
    return {
      name: name(p.name),
      text: p.text,
      revision: revision(p.revision),
      size: Number(p.size),
      modifiedAt: p.modifiedAt,
    };
  }

  async create(page: PageName, text: string): Promise<WriteResult> {
    assertStorableText(page, text);
    const r = await this.#call("CreatePage", CreatePageRequestSchema, CreatePageResponseSchema, { name: page, text });
    return writeResult(r.result);
  }

  async createUnique(desired: string, text: string): Promise<WriteResult> {
    assertStorableText(desired, text);
    const r = await this.#call("CreateUniquePage", CreateUniquePageRequestSchema, CreateUniquePageResponseSchema, {
      desired,
      text,
    });
    return writeResult(r.result);
  }

  async write(page: PageName, text: string, expected?: Revision | null): Promise<WriteResult> {
    assertStorableText(page, text);
    const r = await this.#call("WritePage", WritePageRequestSchema, WritePageResponseSchema, {
      name: page,
      text,
      ...(expected ? { expected } : {}),
    });
    return writeResult(r.result);
  }

  async rename(from: PageName, to: PageName): Promise<WriteResult> {
    const r = await this.#call("RenamePage", RenamePageRequestSchema, RenamePageResponseSchema, { from, to });
    return writeResult(r.result);
  }

  async trash(page: PageName): Promise<TrashEntry> {
    const r = await this.#call("TrashPage", TrashPageRequestSchema, TrashPageResponseSchema, { name: page });
    return trashEntry(r.entry);
  }

  async listTrash(): Promise<TrashEntry[]> {
    const r = await this.#call("ListTrash", ListTrashRequestSchema, ListTrashResponseSchema, {});
    return r.entries.map(trashEntry);
  }

  async restore(id: TrashId): Promise<WriteResult> {
    const r = await this.#call("RestorePage", RestorePageRequestSchema, RestorePageResponseSchema, { id });
    return writeResult(r.result);
  }

  async purge(id: TrashId): Promise<void> {
    await this.#call("PurgePage", PurgePageRequestSchema, PurgePageResponseSchema, { id });
  }
}
