/**
 * Share links (README, "Share links"): one page, or a pair, carried in a
 * link's fragment, which browsers never send to the server.
 *
 * A link is `<origin>/#s1.` followed by base64url (no padding) of an
 * `a4.v1.SharedPages` message compressed with raw DEFLATE. `s1.` is the
 * format version. Each page carries its name, preset, paper, exact UTF-8
 * bytes, and a sealed letter's postmark. No DOM or Node API is used, so the
 * app and the `a4` command share this module.
 */

import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import type { Postmark } from "../gen/a4/v1/letter_pb.js";
import { type SharedPage, SharedPagesSchema } from "../gen/a4/v1/share_pb.js";
import { PageSpecSchema } from "../gen/a4/v1/sheet_pb.js";
import { type PageSpec, type PaperId, type PresetId, pageSpec } from "../page/index.ts";
import { canCompress, deflateRaw, fromBase64Url, inflateRaw, toBase64Url } from "../platform/bytes.ts";
import { paperEnum, pageSpecOf, presetEnum } from "../tensor/record.ts";

/** The longest link A4 makes: long enough for a full page or a pair, short enough for chat and mail. */
export const LINK_LIMIT = 16_384;

/** The most a link's payload may decompress to: 1 MiB, a folder file's cap. */
const PAYLOAD_LIMIT = 1024 * 1024;

/** The production workbench, where `a4 share` links open. */
export { APP_ORIGIN as SHARE_ORIGIN } from "../platform/origin.ts";

const PREFIX = "s1.";

export type ShareProblem = "too-long" | "version" | "malformed" | "too-large" | "pages" | "not-utf8" | "unsupported";

/** Why a link couldn't be made or read, in a sentence a person can act on. */
export class ShareError extends Error {
  override readonly name = "ShareError";
  readonly problem: ShareProblem;
  constructor(problem: ShareProblem, message: string) {
    super(message);
    this.problem = problem;
  }
}

/** A page to share. */
export interface SharePageInput {
  readonly name: string;
  readonly preset: PresetId;
  readonly paper: PaperId;
  /** The page's exact UTF-8 bytes. */
  readonly bytes: Uint8Array;
  /** A sealed letter's postmark. */
  readonly postmark?: Postmark | null;
}

/** A page read from a link. */
export interface SharedPageView {
  readonly name: string;
  readonly spec: PageSpec;
  /** The exact bytes the link carried. */
  readonly bytes: Uint8Array;
  /** The bytes as text, without a leading byte-order mark. */
  readonly text: string;
  readonly postmark: Postmark | null;
}

const strict = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

function unsupported(): ShareError {
  return new ShareError("unsupported", "This browser can’t make or open share links.");
}

function damaged(): ShareError {
  return new ShareError("malformed", "This share link is damaged.");
}

function decodeBase64Url(text: string): Uint8Array {
  const bytes = fromBase64Url(text);
  if (!bytes) throw damaged();
  return bytes;
}

async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  if (!canCompress()) throw unsupported();
  return deflateRaw(bytes);
}

/** Inflate `bytes`, reading at most PAYLOAD_LIMIT bytes before giving up. */
async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  if (!canCompress()) throw unsupported();
  let out: Uint8Array | null;
  try {
    out = await inflateRaw(bytes, PAYLOAD_LIMIT);
  } catch {
    throw damaged();
  }
  if (!out) throw new ShareError("too-large", "This share link holds more than 1 MiB, so it can’t be opened.");
  return out;
}

/**
 * A link to one page, or a pair (A, then B), at `origin`. Refuses a link
 * longer than LINK_LIMIT characters, so nothing too long is ever copied.
 */
export async function shareLink(pages: readonly SharePageInput[], origin: string): Promise<string> {
  if (pages.length < 1 || pages.length > 2) throw new ShareError("pages", "A share link holds one page or two.");
  const message = create(SharedPagesSchema, {
    pages: pages.map((p) => ({
      name: p.name,
      preset: presetEnum(p.preset),
      paper: paperEnum(p.paper),
      text: p.bytes,
      ...(p.postmark ? { postmark: p.postmark } : {}),
    })),
  });
  const payload = toBase64Url(await deflate(toBinary(SharedPagesSchema, message)));
  const link = `${origin.replace(/\/+$/, "")}/#${PREFIX}${payload}`;
  if (link.length > LINK_LIMIT) {
    throw new ShareError(
      "too-long",
      `${pages.length === 1 ? "This page is" : "These pages are"} too large for a link (${link.length.toLocaleString("en-US")} of ${LINK_LIMIT.toLocaleString("en-US")} characters). Download ${pages.length === 1 ? "it" : "them"} instead.`,
    );
  }
  return link;
}

/** The fragment of a link, a "#…" fragment, or a bare "s1.…", without its "#". */
function fragmentOf(input: string): string {
  const at = input.indexOf("#");
  return (at >= 0 ? input.slice(at + 1) : input).trim();
}

/** Whether `input` (a URL or a fragment) looks like a share link of any version. */
export function isShareFragment(input: string): boolean {
  return /^s\d+\./.test(fragmentOf(input));
}

function viewOf(page: SharedPage): SharedPageView {
  const decoded = (() => {
    try {
      return strict.decode(page.text);
    } catch {
      return null;
    }
  })();
  if (decoded === null) throw new ShareError("not-utf8", "A page in this share link isn’t UTF-8 text.");
  // A preset this A4 doesn't know reads as Terminal, on the link's paper (or A4).
  const spec =
    pageSpecOf(create(PageSpecSchema, { preset: page.preset, paper: page.paper })) ??
    pageSpecOf(create(PageSpecSchema, { preset: presetEnum("terminal"), paper: page.paper })) ??
    pageSpec("terminal", "a4");
  return {
    name: page.name.trim() || "Shared page",
    spec,
    bytes: page.text,
    text: decoded.replace(/^﻿/, ""),
    postmark: page.postmark ?? null,
  };
}

/** Read a link (a URL, "#s1.…", or "s1.…") into its pages. Throws a ShareError naming the problem. */
export async function readLink(input: string): Promise<SharedPageView[]> {
  const fragment = fragmentOf(input);
  if (!fragment.startsWith(PREFIX)) {
    if (/^s\d+\./.test(fragment)) {
      throw new ShareError("version", "This share link was made by a newer A4, so this one can’t open it.");
    }
    throw new ShareError("malformed", "This isn’t a share link.");
  }
  const bytes = await inflate(decodeBase64Url(fragment.slice(PREFIX.length)));
  let pages: SharedPage[];
  try {
    pages = fromBinary(SharedPagesSchema, bytes).pages;
  } catch {
    throw new ShareError("malformed", "This share link is damaged.");
  }
  if (pages.length < 1 || pages.length > 2) throw new ShareError("pages", "A share link holds one page or two.");
  return pages.map(viewOf);
}
