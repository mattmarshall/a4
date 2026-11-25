/**
 * Letters: one-page handoff letters in a folder's `.agents/letters/`, and the
 * postmark a person writes beside one when they seal it
 * (proto/a4/v1/letter.proto). The app seals and lists letters with these
 * functions and the a4 command lists and delivers them, so both agree on
 * every state and digest.
 *
 * Runtime-agnostic: it takes a `FolderFs`, and SHA-256 comes from the
 * platform's Web Crypto port, which browsers and Node share.
 */

import { create, fromJsonString, type MessageInitShape, toJsonString } from "@bufbuild/protobuf";
import { timestampFromMs } from "@bufbuild/protobuf/wkt";
import {
  BrokenSeal,
  type Letter,
  type LetterList,
  LetterListSchema,
  LetterSchema,
  LetterState,
  LetterVerdict,
  type Postmark,
  PostmarkSchema,
} from "../gen/a4/v1/letter_pb.js";
import { type PaperId, sizeOfName } from "../page/index.ts";
import { FsError, type FolderFs, isFsError } from "../persist/folder/fs.ts";
import { isLetterPath, LETTERS_DIR } from "../persist/folder/scan.ts";
import { decodeStrict, MAX_FILE_BYTES } from "../persist/store/folder.ts";
import { sha256 } from "../platform/digest.ts";
import { paperEnum } from "../tensor/record.ts";
import { judgeFile } from "./judge.ts";

export type { Letter, LetterList, Postmark } from "../gen/a4/v1/letter_pb.js";
export { BrokenSeal, LetterListSchema, LetterState, LetterVerdict, PostmarkSchema } from "../gen/a4/v1/letter_pb.js";

// The folder list and the desk share one rule for what a letter is.
export { isLetterPath, LETTERS_DIR } from "../persist/folder/scan.ts";

/**
 * A new letter's path: `.agents/letters/<UTC YYYY-MM-DD-HHMM>-<topic>.md`, with
 * `-2` to `-9` for the `n`th letter on that topic in the same minute (one
 * digit, so they sort in order). UTC, so names sort oldest to newest wherever
 * they were written. The topic is the caller's to check (the mailroom allows
 * only a-z, 0-9, and inner hyphens).
 */
export function letterPathAt(now: number, n = 1, topic = "letter", paper: PaperId = "a4"): string {
  const t = new Date(now);
  const two = (v: number) => String(v).padStart(2, "0");
  const stamp = `${t.getUTCFullYear()}-${two(t.getUTCMonth() + 1)}-${two(t.getUTCDate())}-${two(t.getUTCHours())}${two(t.getUTCMinutes())}`;
  // A card or a postcard says its size in its name, before the extension.
  const size = paper === "a4" ? "" : `.${paper}`;
  return `${LETTERS_DIR}/${stamp}-${topic}${n > 1 ? `-${n}` : ""}${size}.md`;
}

/**
 * Letter order: by file name without its `.md` extension, by code unit, so
 * "…-0930-letter" comes before "…-0930-letter-2" (with the extension, "-"
 * sorts before ".") and timestamped names sort oldest to newest everywhere.
 */
export function compareLetterNames(a: string, b: string): number {
  const stem = (name: string) => name.replace(/\.md$/i, "");
  const x = stem(a);
  const y = stem(b);
  return Number(x > y) - Number(x < y);
}

/** Where a letter's postmark lives: beside it, as `<name>.postmark.json`. */
export function postmarkPath(letterPath: string): string {
  return `${letterPath}.postmark.json`;
}

const DIGEST_PREFIX = "urn:a4:letter:sha256:";

/** SHA-256 of a letter's exact bytes, as `urn:a4:letter:sha256:<64 hex>`. */
export async function letterDigest(bytes: Uint8Array): Promise<string> {
  const hash = await sha256(bytes);
  return DIGEST_PREFIX + Array.from(hash, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** A letter as read: its listed row, and its text and digest when the file could be read. */
export interface ReadLetter {
  readonly letter: Letter;
  /** The file's text, or null when it's over 1 MiB or not UTF-8. */
  readonly text: string | null;
  /**
   * The digest of the file's current bytes (a draft's too), or null when the
   * file can't be read. Taken from the bytes, not the decoded text, which
   * drops a byte-order mark.
   */
  readonly digest: string | null;
}

/** A postmark file's size limit; a real one is a few hundred bytes. */
const MAX_POSTMARK_BYTES = 64 * 1024;

/**
 * Parse a postmark for the letter file `name`, or null when it isn't a
 * readable one: proto3 JSON naming that letter, with a letter digest and an
 * accept or return verdict.
 */
export function readPostmark(bytes: Uint8Array | null, name: string): Postmark | null {
  const json = bytes ? decodeStrict(bytes) : null;
  if (json === null) return null;
  try {
    const postmark = fromJsonString(PostmarkSchema, json, { ignoreUnknownFields: true });
    const verdictKnown = postmark.verdict === LetterVerdict.ACCEPTED || postmark.verdict === LetterVerdict.RETURNED;
    if (postmark.letter !== name || !postmark.digest.startsWith(DIGEST_PREFIX) || !verdictKnown) return null;
    return postmark;
  } catch {
    return null;
  }
}

async function readOne(fs: FolderFs, name: string): Promise<ReadLetter> {
  const path = `${LETTERS_DIR}/${name}`;
  const { bytes } = await fs.readBytes(path, { maxBytes: MAX_FILE_BYTES });
  const text = bytes ? decodeStrict(bytes) : null;
  const size = sizeOfName(name);
  const rowsUsed = text === null ? 0 : judgeFile(text, size).fit.rowsUsed;
  // Only a readable letter has a digest: one over 1 MiB or not UTF-8 can't be delivered or matched.
  const digest = bytes === null || text === null ? null : await letterDigest(bytes);
  const row = (init: MessageInitShape<typeof LetterSchema>) =>
    create(LetterSchema, { path, rowsUsed, paper: paperEnum(size), ...init });
  if (!(await fs.stat(postmarkPath(path)))) return { letter: row({ state: LetterState.DRAFT }), text, digest };
  const sidecar = await fs.readBytes(postmarkPath(path), { maxBytes: MAX_POSTMARK_BYTES });
  const postmark = readPostmark(sidecar.bytes, name);
  if (!postmark) {
    return {
      letter: row({ state: LetterState.BROKEN, broken: BrokenSeal.UNREADABLE_POSTMARK }),
      text,
      digest,
    };
  }
  if (digest === null) {
    return {
      letter: row({ state: LetterState.BROKEN, broken: BrokenSeal.UNREADABLE_LETTER, postmark }),
      text,
      digest,
    };
  }
  if (digest !== postmark.digest) {
    return { letter: row({ state: LetterState.BROKEN, broken: BrokenSeal.CHANGED, postmark }), text, digest };
  }
  const state = postmark.verdict === LetterVerdict.ACCEPTED ? LetterState.ACCEPTED : LetterState.RETURNED;
  return { letter: row({ state, postmark }), text, digest };
}

/** Every letter in `fs`, oldest first (by file name). A folder without `.agents/letters/` has none. */
export async function readLetters(fs: FolderFs): Promise<ReadLetter[]> {
  const names: string[] = [];
  try {
    for await (const entry of fs.entries(LETTERS_DIR)) {
      if (entry.kind === "file" && isLetterPath(`${LETTERS_DIR}/${entry.name}`)) names.push(entry.name);
    }
  } catch (error) {
    if (error instanceof FsError && error.code === "not-found") return [];
    throw error;
  }
  names.sort(compareLetterNames);
  const letters: ReadLetter[] = [];
  for (const name of names) {
    try {
      letters.push(await readOne(fs, name));
    } catch (error) {
      // Gone since the listing.
      if (!(error instanceof FsError && error.code === "not-found")) throw error;
    }
  }
  return letters;
}

/** The list `a4 letters --json` prints: every letter, oldest first, without text. */
export function letterList(letters: readonly ReadLetter[]): LetterList {
  return create(LetterListSchema, { letters: letters.map((l) => l.letter) });
}

/** The newest intact accepted letter, and the letters returned after it. */
export interface Delivery {
  readonly letter: ReadLetter;
  readonly text: string;
  readonly returnedSince: readonly ReadLetter[];
}

/** What a session should receive: the newest accepted letter whose seal is intact, or null. */
export function latestDelivery(letters: readonly ReadLetter[]): Delivery | null {
  for (let i = letters.length - 1; i >= 0; i--) {
    const candidate = letters[i];
    if (candidate?.letter.state === LetterState.ACCEPTED && candidate.text !== null) {
      const returnedSince = letters.slice(i + 1).filter((l) => l.letter.state === LetterState.RETURNED);
      return { letter: candidate, text: candidate.text, returnedSince };
    }
  }
  return null;
}

/** The postmark already exists: a letter is sealed once. */
export class PostmarkExistsError extends Error {
  readonly letterPath: string;
  constructor(letterPath: string) {
    super(`“${letterPath}” is already sealed.`);
    this.name = "PostmarkExistsError";
    this.letterPath = letterPath;
  }
}

export type SealRefusal = "not-a-letter" | "blank-signer" | "no-reason" | "unreadable" | "over-page";

/** A seal A4 won't write; nothing was changed. */
export class SealRefusedError extends Error {
  readonly reason: SealRefusal;
  /** Rows over the page, for "over-page". */
  readonly overBy: number;
  constructor(reason: SealRefusal, message: string, overBy = 0) {
    super(message);
    this.name = "SealRefusedError";
    this.reason = reason;
    this.overBy = overBy;
  }
}

export interface SealOptions {
  readonly verdict: "accepted" | "returned";
  /** Required to return a letter; an optional note when accepting. */
  readonly reason?: string;
  readonly signer: string;
  /** Epoch milliseconds: when it was sealed. */
  readonly now: number;
}

/** The postmark as written to disk: pretty proto3 JSON and a final newline. */
export function postmarkJson(postmark: Postmark): string {
  return `${toJsonString(PostmarkSchema, postmark, { prettySpaces: 2 })}\n`;
}

/**
 * Seal the letter at `path`: write its postmark beside it and return it. The
 * letter's bytes don't change, and an existing postmark is never replaced.
 * The caller serializes seals of one letter (the app holds the folder's lock).
 * @throws PostmarkExistsError, SealRefusedError
 */
export async function sealLetter(fs: FolderFs, path: string, options: SealOptions): Promise<Postmark> {
  if (!isLetterPath(path)) throw new SealRefusedError("not-a-letter", `“${path}” isn’t a letter.`);
  const signer = options.signer.trim();
  if (signer === "") throw new SealRefusedError("blank-signer", "Enter your name to seal a letter.");
  const reason = (options.reason ?? "").trim();
  if (options.verdict === "returned" && reason === "") {
    throw new SealRefusedError("no-reason", "Say why you’re returning the letter.");
  }
  const sidecar = postmarkPath(path);
  if (await fs.stat(sidecar)) throw new PostmarkExistsError(path);
  const { bytes } = await fs.readBytes(path, { maxBytes: MAX_FILE_BYTES });
  const text = bytes ? decodeStrict(bytes) : null;
  if (bytes === null || text === null) {
    throw new SealRefusedError("unreadable", `“${path}” isn’t UTF-8 text of at most 1 MiB.`);
  }
  if (options.verdict === "accepted") {
    const { fit } = judgeFile(text, sizeOfName(path));
    if (!fit.fits) {
      throw new SealRefusedError(
        "over-page",
        `The letter is ${fit.overBy} ${fit.overBy === 1 ? "row" : "rows"} over the page.`,
        fit.overBy,
      );
    }
  }
  const name = path.slice(LETTERS_DIR.length + 1);
  const before = (await readLetters(fs)).filter(
    (l) =>
      l.letter.state === LetterState.ACCEPTED &&
      compareLetterNames(l.letter.path.slice(LETTERS_DIR.length + 1), name) < 0,
  );
  const postmark = create(PostmarkSchema, {
    letter: name,
    digest: await letterDigest(bytes),
    verdict: options.verdict === "accepted" ? LetterVerdict.ACCEPTED : LetterVerdict.RETURNED,
    reason,
    signer,
    sealedAt: timestampFromMs(options.now),
    parent: before.at(-1)?.letter.postmark?.digest ?? "",
  });
  try {
    // Exclusive: a postmark written since the check above, by any process, is never replaced.
    await fs.writeAtomic(sidecar, new TextEncoder().encode(postmarkJson(postmark)), { exclusive: true });
  } catch (error) {
    if (isFsError(error, "exists")) throw new PostmarkExistsError(path);
    throw error;
  }
  return postmark;
}
