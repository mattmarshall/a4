/**
 * Which library the workspace shows, and what each one keeps apart from the
 * others (README, "Served library"):
 *
 * - drafts: a journal prefix (`a4:` for this browser's, so existing drafts
 *   keep their keys; `a4:served:<library id>:` for a served one);
 * - tab messages: a channel (`a4-pages`, or `a4-pages:served:<library id>`);
 * - remembered open pages: `openA`/`openB`, or `served:<library id>:open:a`
 *   and `…:b`.
 *
 * A served library is known by the id its folder keeps, not by the address
 * it's served at, so another folder served on the same port is another
 * library. Before libraries had ids, drafts were kept by address and open
 * pages under one pair of keys; `addressKeys` names them, for adopting once.
 */

import { LIBRARY_CHANNEL } from "../persist/library-events.ts";
import { type Setting, SETTINGS, servedOpenSetting } from "../persist/settings.ts";
import type { PageRef } from "../persist/store/refs.ts";
import { RemotePageStore, type ServedStore } from "../persist/store/remote.ts";
import { sameConnection, type ServedConnection } from "../persist/store/served.ts";
import type { LibraryId } from "../persist/store/wire.ts";
import type { Slot } from "./types.ts";

/** The library the author picks: this browser's, or the one at a served connection. */
export type LibraryChoice =
  | { readonly kind: "browser" }
  | { readonly kind: "served"; readonly connection: ServedConnection };

export type BrowserTarget = { readonly kind: "browser" };

/** A served library, reached and known by its id. */
export type ServedTarget = {
  readonly kind: "served";
  readonly connection: ServedConnection;
  readonly library: LibraryId;
};

/** The library shown: this browser's, or a served one. */
export type LibraryTarget = BrowserTarget | ServedTarget;

export const BROWSER: BrowserTarget = { kind: "browser" };

/** Whether `shown` is already the library `choice` picks: the same kind, and for a served one the same connection. */
export function isShown(shown: LibraryTarget | null, choice: LibraryChoice): boolean {
  if (shown?.kind !== choice.kind) return false;
  return shown.kind === "browser" || (choice.kind === "served" && sameConnection(shown.connection, choice.connection));
}

export function journalPrefix(target: LibraryTarget): string {
  return target.kind === "browser" ? "a4:" : `a4:served:${target.library}:`;
}

export function channelName(target: LibraryTarget): string {
  return target.kind === "browser" ? LIBRARY_CHANNEL : `${LIBRARY_CHANNEL}:served:${target.library}`;
}

/** Where `target`'s open pages are remembered. */
export function openSettings(target: LibraryTarget | null): Record<Slot, Setting<PageRef | null>> {
  return target?.kind === "served"
    ? { a: servedOpenSetting(target.library, "a"), b: servedOpenSetting(target.library, "b") }
    : { a: SETTINGS.openA, b: SETTINGS.openB };
}

/** What was kept for a served library at `address` before libraries had ids: adopted once, then removed. */
export function addressKeys(address: string): {
  readonly journalPrefix: string;
  readonly open: Record<Slot, Setting<PageRef | null>>;
} {
  return {
    journalPrefix: `a4:served:${address}:`,
    open: { a: SETTINGS.servedOpenA, b: SETTINGS.servedOpenB },
  };
}

/** The served library's store by default: `a4 serve` over HTTP at the connection's address. */
export function defaultServedStore(connection: ServedConnection): ServedStore {
  return new RemotePageStore({ base: `http://${connection.address}`, token: connection.token });
}
