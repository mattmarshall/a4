/**
 * The mailroom's rules: checking a page, filing a letter, and reading letters
 * for `a4 mailroom`'s MCP tools (cli/mailroom.ts). Results are the records in
 * proto/a4/v1/mailroom.proto. Filing writes only a new draft letter, never
 * over a file, and nothing here seals: agents write, people seal.
 *
 * Runtime-agnostic, like the rest of the desk: it takes a `FolderFs` and a
 * clock. It isn't re-exported from the desk index, because it imports the
 * mailroom and lint protos, which the app's first load doesn't need.
 */

import { create } from "@bufbuild/protobuf";
import { LintOutcome } from "../gen/a4/v1/lint_pb.js";
import {
  type FiledLetter,
  FiledLetterSchema,
  FilingRefusal,
  type LetterDelivery,
  LetterDeliverySchema,
  type PageCheck,
  PageCheckSchema,
} from "../gen/a4/v1/mailroom_pb.js";
import { type FolderFs, isFsError } from "../persist/folder/fs.ts";
import { MAX_FILE_BYTES } from "../persist/store/folder.ts";
import { judgeFile, type Judgment, type Outcome, outcomeOf } from "./judge.ts";
import { latestDelivery, letterDigest, letterPathAt, LetterState, type ReadLetter } from "./letters.ts";

export type { FiledLetter, LetterDelivery, PageCheck } from "../gen/a4/v1/mailroom_pb.js";
export { FiledLetterSchema, FilingRefusal, LetterDeliverySchema, PageCheckSchema } from "../gen/a4/v1/mailroom_pb.js";

const OUTCOME: Record<Outcome, LintOutcome> = {
  pass: LintOutcome.PASS,
  warn: LintOutcome.WARN,
  fail: LintOutcome.FAIL,
};

export type TextProblem = "empty" | "too-large";

/** Why the desk won't take `text`: blank, or over 1 MiB as UTF-8. Null when it will. */
export function textProblem(text: string): TextProblem | null {
  if (text.trim() === "") return "empty";
  if (new TextEncoder().encode(text).length > MAX_FILE_BYTES) return "too-large";
  return null;
}

/** A page's check, and the judgment behind it (for findings in words). */
export interface Checked {
  readonly check: PageCheck;
  readonly judgment: Judgment;
}

/** Judge `text` as the folder view shows it on the Terminal page, the way `a4 lint` judges a file. */
export function checkPage(text: string): Checked {
  const judgment = judgeFile(text);
  const { fit } = judgment;
  const check = create(PageCheckSchema, {
    outcome: OUTCOME[outcomeOf(judgment)],
    rowsUsed: fit.rowsUsed,
    pageRows: fit.pageRows,
    overBy: fit.overBy,
    report: judgment.report,
  });
  return { check, judgment };
}

/** The longest topic a letter's name may carry. */
export const MAX_TOPIC = 40;
const TOPIC = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** A topic is 1 to 40 characters of a-z and 0-9, with single hyphens inside: never a path. */
export function isTopic(topic: string): boolean {
  return topic.length <= MAX_TOPIC && TOPIC.test(topic);
}

/** How many names one topic gets in one minute: the name, then -2 to -9. */
const NAMES_PER_MINUTE = 9;

export interface FileOptions {
  /** Epoch milliseconds: names the letter by this minute, in UTC. */
  readonly now: number;
  /** Default "letter". */
  readonly topic?: string;
}

/** A filing's record, and the judgment behind its check when the text was judged. */
export interface Filing {
  readonly filed: FiledLetter;
  readonly judgment: Judgment | null;
}

/**
 * File `text` as a new draft letter in `.agents/letters/`, exactly as given.
 * Every check comes first, so a refused letter writes nothing. The write is
 * exclusive: a taken name (even one taken a moment ago by another process)
 * moves on to the next number, and no file is ever replaced.
 * @throws FsError for a failure other than a taken name
 */
export async function fileLetter(fs: FolderFs, text: string, options: FileOptions): Promise<Filing> {
  const refuse = (refusal: FilingRefusal, checked: Checked | null = null): Filing => ({
    filed: create(FiledLetterSchema, { refusal, ...(checked ? { check: checked.check } : {}) }),
    judgment: checked?.judgment ?? null,
  });
  const topic = options.topic ?? "letter";
  if (!isTopic(topic)) return refuse(FilingRefusal.BAD_TOPIC);
  const problem = textProblem(text);
  if (problem === "empty") return refuse(FilingRefusal.EMPTY);
  if (problem === "too-large") return refuse(FilingRefusal.TOO_LARGE);
  const checked = checkPage(text);
  if (!checked.judgment.fit.fits) return refuse(FilingRefusal.OVER_PAGE, checked);
  const bytes = new TextEncoder().encode(text);
  for (let n = 1; n <= NAMES_PER_MINUTE; n++) {
    const path = letterPathAt(options.now, n, topic);
    try {
      await fs.writeAtomic(path, bytes, { exclusive: true });
    } catch (error) {
      if (isFsError(error, "exists")) continue;
      throw error;
    }
    const digest = await letterDigest(bytes);
    return {
      filed: create(FiledLetterSchema, { filed: true, path, digest, check: checked.check }),
      judgment: checked.judgment,
    };
  }
  return refuse(FilingRefusal.NO_FREE_NAME, checked);
}

const DIGEST = /^urn:a4:letter:sha256:[0-9a-f]{64}$/;

/** A well-formed letter digest: `urn:a4:letter:sha256:` and 64 lowercase hexadecimal digits. */
export function isLetterDigest(digest: string): boolean {
  return DIGEST.test(digest);
}

/** Accepted with its seal intact, and readable: the only letters ever delivered. */
function deliverable(letter: ReadLetter): boolean {
  return letter.letter.state === LetterState.ACCEPTED && letter.text !== null;
}

/**
 * The letter whose postmark or current bytes have `digest`, or null. When
 * several match (the same bytes filed twice), the newest deliverable one wins,
 * and then the newest.
 */
export function findLetter(letters: readonly ReadLetter[], digest: string): ReadLetter | null {
  const matches = letters.filter((l) => l.digest === digest || l.letter.postmark?.digest === digest);
  return matches.findLast(deliverable) ?? matches.at(-1) ?? null;
}

/** What `a4 letters --latest` delivers, as a record: the letter, its text, and the letters returned since. */
export function deliverLatest(letters: readonly ReadLetter[]): LetterDelivery {
  const delivery = latestDelivery(letters);
  if (!delivery) return create(LetterDeliverySchema, {});
  return create(LetterDeliverySchema, {
    delivered: true,
    letter: delivery.letter.letter,
    text: delivery.text,
    returnedSince: delivery.returnedSince.map((l) => l.letter),
  });
}

/** The letter with `digest`: its text only when it's deliverable, otherwise its row (state, reason) alone. */
export function deliverByDigest(letters: readonly ReadLetter[], digest: string): LetterDelivery {
  const found = findLetter(letters, digest);
  if (!found) return create(LetterDeliverySchema, {});
  if (deliverable(found) && found.text !== null) {
    return create(LetterDeliverySchema, { delivered: true, letter: found.letter, text: found.text });
  }
  return create(LetterDeliverySchema, { letter: found.letter });
}
