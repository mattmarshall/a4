/**
 * The served library's store as the workspace uses it: it changes only the
 * library it was reached as. Before each change (a save, a new page, a
 * rename, the trash), it asks `a4 serve` which library it serves.
 *
 * - **Another library** (a different folder now served at the same address
 *   with the same token): the change fails as unavailable, and a save's text
 *   stays in the draft journal under the first library's id, recovered when
 *   that library is shown again. Without the check, a save retried in the
 *   seconds before the poller notices would land in the other folder.
 * - **Refused** (a new token, or another protocol version): the change fails
 *   with that refusal, and the server receives no page operation.
 *
 * Reads aren't checked: the poller notices another library within one pass,
 * and nothing is written meanwhile.
 */

import type { ServedStore } from "../persist/store/remote.ts";
import {
  type PageName,
  type Revision,
  StoreUnavailableError,
  type TrashId,
  type WriteResult,
} from "../persist/store/types.ts";
import type { LibraryId } from "../persist/store/wire.ts";

export class ConfirmedStore implements ServedStore {
  readonly kind = "served" as const;
  readonly durable: boolean;
  readonly #store: ServedStore;
  readonly #library: LibraryId;
  readonly #address: string;

  constructor(store: ServedStore, library: LibraryId, address: string) {
    this.#store = store;
    this.#library = library;
    this.#address = address;
    this.durable = store.durable;
  }

  /** Throws unless the server still serves this library. */
  async #confirm(): Promise<void> {
    if ((await this.#store.library()) === this.#library) return;
    throw new StoreUnavailableError(`a4 serve at ${this.#address} now serves another library.`);
  }

  library(): Promise<LibraryId> {
    return this.#store.library();
  }
  list() {
    return this.#store.list();
  }
  read(name: PageName) {
    return this.#store.read(name);
  }
  listTrash() {
    return this.#store.listTrash();
  }
  async create(name: PageName, text: string): Promise<WriteResult> {
    await this.#confirm();
    return this.#store.create(name, text);
  }
  async createUnique(desired: string, text: string): Promise<WriteResult> {
    await this.#confirm();
    return this.#store.createUnique(desired, text);
  }
  async write(name: PageName, text: string, expected?: Revision | null): Promise<WriteResult> {
    await this.#confirm();
    return this.#store.write(name, text, expected);
  }
  async rename(from: PageName, to: PageName): Promise<WriteResult> {
    await this.#confirm();
    return this.#store.rename(from, to);
  }
  async trash(name: PageName) {
    await this.#confirm();
    return this.#store.trash(name);
  }
  async restore(id: TrashId): Promise<WriteResult> {
    await this.#confirm();
    return this.#store.restore(id);
  }
  async purge(id: TrashId): Promise<void> {
    await this.#confirm();
    return this.#store.purge(id);
  }
}
