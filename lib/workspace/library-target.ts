/**
 * Which library the workspace shows, and what each one keeps apart from the
 * other (README, "Served library"):
 *
 * - drafts: a journal prefix (`a4:` for this browser's, so existing drafts
 *   keep their keys; `a4:served:<address>:` for the served one);
 * - tab messages: a channel (`a4-pages`, or `a4-pages:<address>`);
 * - remembered open pages: `openA`/`openB`, or `servedOpenA`/`servedOpenB`.
 */

import { LIBRARY_CHANNEL } from "../persist/library-events.ts";
import { type Setting, SETTINGS, writeSetting } from "../persist/settings.ts";
import type { PageRef } from "../persist/store/refs.ts";
import { RemotePageStore } from "../persist/store/remote.ts";
import { sameConnection, type ServedConnection } from "../persist/store/served.ts";
import type { PageStore } from "../persist/store/types.ts";
import type { Slot } from "./types.ts";

export type LibraryTarget =
  | { readonly kind: "browser" }
  | { readonly kind: "served"; readonly connection: ServedConnection };

export const BROWSER: LibraryTarget = { kind: "browser" };

export function sameTarget(a: LibraryTarget | null, b: LibraryTarget): boolean {
  if (a?.kind !== b.kind) return false;
  return a.kind === "browser" || (b.kind === "served" && sameConnection(a.connection, b.connection));
}

export function journalPrefix(target: LibraryTarget): string {
  return target.kind === "browser" ? "a4:" : `a4:served:${target.connection.address}:`;
}

export function channelName(target: LibraryTarget): string {
  return target.kind === "browser" ? LIBRARY_CHANNEL : `${LIBRARY_CHANNEL}:${target.connection.address}`;
}

/** Where `target`'s open pages are remembered. */
export function openSettings(target: LibraryTarget | null): Record<Slot, Setting<PageRef | null>> {
  return target?.kind === "served"
    ? { a: SETTINGS.servedOpenA, b: SETTINGS.servedOpenB }
    : { a: SETTINGS.openA, b: SETTINGS.openB };
}

/** Forget the pages remembered for the served library (its address changed, or it was disconnected). */
export function forgetServedPages(): void {
  writeSetting(SETTINGS.servedOpenA, null);
  writeSetting(SETTINGS.servedOpenB, null);
}

/** The served library's store by default: `a4 serve` over HTTP at the connection's address. */
export function defaultServedStore(connection: ServedConnection): PageStore {
  return new RemotePageStore({ base: `http://${connection.address}`, token: connection.token });
}
