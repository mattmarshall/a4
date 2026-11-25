/**
 * A shared letter's seal: whether the bytes a link carries still match the
 * digest in its postmark. A seal records that the named person accepted or
 * returned the letter. It doesn't prove who sealed it, since anyone can put a
 * postmark in a link, so nothing here ever writes one.
 */

import type { Postmark } from "../gen/a4/v1/letter_pb.js";
import { letterDigest } from "../desk/letters.ts";
import type { SharedPageView } from "./link.ts";

export type SealOf =
  | { readonly kind: "none" }
  | { readonly kind: "intact"; readonly postmark: Postmark }
  | { readonly kind: "changed"; readonly postmark: Postmark };

/** The seal of a shared page: none, intact, or changed since it was sealed. */
export async function sealOf(page: Pick<SharedPageView, "bytes" | "postmark">): Promise<SealOf> {
  const { postmark } = page;
  if (!postmark) return { kind: "none" };
  return (await letterDigest(page.bytes)) === postmark.digest
    ? { kind: "intact", postmark }
    : { kind: "changed", postmark };
}
