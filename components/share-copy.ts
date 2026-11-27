/**
 * Share links in English: the copy notices, the shared view's banner, and a
 * shared letter's seal. The app and the `a4 share` and `a4 open` commands
 * say these things, so they say them the same way.
 *
 * Like desk-copy.ts, it imports lib/ by relative path, so the `a4` command
 * can load it under Node without the app's path aliases.
 */

import { timestampDate } from "@bufbuild/protobuf/wkt";
import { BrokenSeal, LetterVerdict } from "../lib/desk/index.ts";
import type { PageSpec } from "../lib/page/index.ts";
import type { SealOf } from "../lib/share/index.ts";
import { BROKEN_SEAL_REASON } from "./desk-copy.ts";

const quoted = (names: readonly string[]) => names.map((n) => `“${n}”`).join(" and ");

/** After a link is copied: what it holds, and who can read it. */
export function copiedNotice(names: readonly string[], length: number): string {
  const what = names.length === 1 ? `a link to ${quoted(names)}` : `a link to ${quoted(names)}, as a pair`;
  return `Copied ${what} (${length.toLocaleString("en-US")} characters). Anyone with the link can read ${names.length === 1 ? "the page" : "both pages"}.`;
}

/** When the browser blocks the clipboard. */
export const CLIPBOARD_BLOCKED = "Copy failed: clipboard access was blocked";

/** The shared view's banner: what's showing, and that it isn't saved. */
export function sharedBanner(names: readonly string[]): string {
  return `${names.length === 1 ? "Shared page" : "Shared pages"} ${quoted(names)}: read-only, and not saved in your library.`;
}

/** A page's preset and paper, as "Pica, A5". */
export function specLabel(spec: Pick<PageSpec, "name" | "paper">): string {
  return `${spec.name}, ${spec.paper.toUpperCase()}`;
}

/** The banner's note: what the shared pages are shown on, as their sender saw them. */
export function sharedShownOn(specs: readonly Pick<PageSpec, "name" | "paper">[]): string {
  return `Shown on ${specs.map(specLabel).join(" and ")}, as the sender saw ${specs.length === 1 ? "it" : "them"}.`;
}

/** Before a seal line in a shared pair: which page the seal is on. */
export function sharedSealFor(name: string): string {
  return `“${name}”: `;
}

/** The shared view's banner: its label for assistive technology, and its buttons. */
export const sharedViewCopy = { label: "Shared page", saveCopy: "Save a copy", close: "Close" } as const;

/** After Save a copy: the pages now in the reader's library. */
export function savedSharedCopies(names: readonly string[]): string {
  return `Saved ${quoted(names)} to your library.`;
}

/** The top bar's pill for a shared page, in place of its save status. */
export const SHARED_PILL = "Shared · not saved";

/** When a share link can't be read, and the error doesn't say why. */
export const SHARE_LINK_UNREADABLE = "This share link can’t be opened.";

/** What a seal in a link means, and doesn't. */
export const SEAL_MEANING =
  "A seal records that the named person accepted or returned this letter. It doesn’t prove who sealed it or make the letter true, and anyone can make a link.";

/** A shared letter's seal in one line, or null when the page has none. */
export function sealLine(seal: SealOf): string | null {
  if (seal.kind === "none") return null;
  const { postmark } = seal;
  if (seal.kind === "changed") return `Seal broken: the letter ${BROKEN_SEAL_REASON[BrokenSeal.CHANGED]}.`;
  const verdict = postmark.verdict === LetterVerdict.RETURNED ? "Returned" : "Accepted";
  const by = postmark.signer ? ` by ${postmark.signer}` : "";
  const when = postmark.sealedAt ? ` on ${timestampDate(postmark.sealedAt).toISOString().slice(0, 10)}` : "";
  const reason = postmark.reason ? `: ${postmark.reason}` : "";
  return `${verdict}${by}${when}${reason}. Seal intact.`;
}
