/**
 * A PageStore served by `a4 serve` (README, "Served library"): each operation
 * is one POST to `<base>/a4.v1.PageStoreService/<Method>` with the library's
 * token, and protobuf bodies both ways (proto/a4/v1/store.proto), encoded and
 * decoded by the wire module both sides share (wire.ts).
 *
 * A store error comes back as an `a4.v1.StoreFailure` and is thrown as the
 * same typed error the browser's own store throws, so autosave, conflicts,
 * and retries work as they do there. Anything else is StoreUnavailableError,
 * with why:
 * - not-running: the request couldn't reach the server;
 * - refused: the server refused the token or this page's origin;
 * - older-server: it doesn't know the method (an older checkout);
 * - newer-server or older-server: `library()` found another protocol version;
 * - bad-answer: an answer A4 can't read.
 */

import { fromBinary } from "@bufbuild/protobuf";
import { StoreErrorCode, type StoreFailure, StoreFailureSchema } from "../../gen/a4/v1/store_pb.js";
import {
  assertStorableText,
  type Page,
  type PageName,
  type PageStore,
  type PageSummary,
  type Revision,
  StoreUnavailableError,
  type TrashEntry,
  type TrashId,
  type WriteResult,
} from "./types.ts";
import {
  decodeResponse,
  encodeRequest,
  errorFrom,
  type LibraryId,
  libraryFrom,
  olderServer,
  pageWire,
  STORE_PATH,
  type StoreMethod,
  type StoreRequestInit,
  type StoreResponse,
  summaryWire,
  trashWire,
  wireName,
  writeWire,
} from "./wire.ts";

/** A served library's store: a PageStore that can say which library it is. */
export interface ServedStore extends PageStore {
  /**
   * The library's id, once the server is reached and speaks this app's
   * protocol. @throws StoreUnavailableError with why it can't be used.
   */
  library(): Promise<LibraryId>;
}

export interface RemotePageStoreOptions {
  /** The server, such as "http://127.0.0.1:4320". */
  readonly base: string;
  readonly token: string;
  readonly fetch?: typeof fetch;
}

export class RemotePageStore implements ServedStore {
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

  async #call<K extends StoreMethod>(method: K, request: StoreRequestInit<K>): Promise<StoreResponse<K>> {
    let response: Response;
    try {
      response = await this.#fetch(`${this.#base}${STORE_PATH}${wireName(method)}`, {
        method: "POST",
        headers: { "content-type": "application/proto", authorization: `Bearer ${this.#token}` },
        body: encodeRequest(method, request),
        credentials: "omit",
        referrerPolicy: "no-referrer",
      });
    } catch {
      throw new StoreUnavailableError(`a4 serve isn’t running at ${this.address}.`, "not-running");
    }
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await response.arrayBuffer());
    } catch {
      // The answer was cut off (the server stopped mid-response): never read it as an empty one.
      throw new StoreUnavailableError(`a4 serve isn’t running at ${this.address}.`, "not-running");
    }
    if (response.ok) {
      try {
        return decodeResponse(method, bytes);
      } catch {
        throw new StoreUnavailableError("a4 serve sent an answer A4 can’t read.", "bad-answer");
      }
    }
    if (response.status === 401 || response.status === 403) {
      throw new StoreUnavailableError(`a4 serve at ${this.address} refused this browser’s token.`, "refused");
    }
    let failure: StoreFailure | null = null;
    try {
      failure = bytes.length > 0 ? fromBinary(StoreFailureSchema, bytes) : null;
    } catch {
      failure = null;
    }
    if (failure && failure.code !== StoreErrorCode.UNSPECIFIED) throw errorFrom(failure);
    // A 404 with no failure: the server doesn't know this method, so it's from an older checkout.
    if (response.status === 404 && bytes.length === 0) throw olderServer(this.address);
    throw new StoreUnavailableError(`a4 serve at ${this.address} answered ${response.status}.`, "bad-answer");
  }

  async library(): Promise<LibraryId> {
    const r = await this.#call("getLibrary", {});
    return libraryFrom(r.library, this.address);
  }

  async list(): Promise<PageSummary[]> {
    return (await this.#call("listPages", {})).pages.map(summaryWire.from);
  }

  async read(page: PageName): Promise<Page> {
    return pageWire.from((await this.#call("readPage", { name: page })).page);
  }

  async create(page: PageName, text: string): Promise<WriteResult> {
    assertStorableText(page, text);
    return writeWire.from((await this.#call("createPage", { name: page, text })).result);
  }

  async createUnique(desired: string, text: string): Promise<WriteResult> {
    assertStorableText(desired, text);
    return writeWire.from((await this.#call("createUniquePage", { desired, text })).result);
  }

  async write(page: PageName, text: string, expected?: Revision | null): Promise<WriteResult> {
    assertStorableText(page, text);
    const r = await this.#call("writePage", { name: page, text, ...(expected ? { expected } : {}) });
    return writeWire.from(r.result);
  }

  async rename(from: PageName, to: PageName): Promise<WriteResult> {
    return writeWire.from((await this.#call("renamePage", { from, to })).result);
  }

  async trash(page: PageName): Promise<TrashEntry> {
    return trashWire.from((await this.#call("trashPage", { name: page })).entry);
  }

  async listTrash(): Promise<TrashEntry[]> {
    return (await this.#call("listTrash", {})).entries.map(trashWire.from);
  }

  async restore(id: TrashId): Promise<WriteResult> {
    return writeWire.from((await this.#call("restorePage", { id })).result);
  }

  async purge(id: TrashId): Promise<void> {
    await this.#call("purgePage", { id });
  }
}
