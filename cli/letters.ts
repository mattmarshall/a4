/**
 * `a4 letters [folder] [--latest | --json]`: list a folder's letters, oldest
 * first, or deliver the newest accepted one whose seal is intact (README,
 * "Letters"). Only reads, and makes no network request.
 */

import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { toJsonString } from "@bufbuild/protobuf";
import {
  BrokenSeal,
  deskPage,
  latestDelivery,
  LETTERS_DIR,
  letterList,
  LetterListSchema,
  LetterState,
  type ReadLetter,
  readLetters,
} from "../lib/desk/index.ts";
import { sizeOfName } from "../lib/page/index.ts";
import { nodeFolderSource } from "../lib/persist/folder/fs-node.ts";
import { UsageError } from "./usage.ts";

export interface LettersArgs {
  readonly folder: string;
  readonly latest: boolean;
  readonly json: boolean;
}

const LETTER_STATE: Record<LetterState, string> = {
  [LetterState.UNSPECIFIED]: "?",
  [LetterState.DRAFT]: "draft",
  [LetterState.ACCEPTED]: "accepted",
  [LetterState.RETURNED]: "returned",
  [LetterState.BROKEN]: "broken",
};

const BROKEN_NOTE: Record<BrokenSeal, string> = {
  [BrokenSeal.UNSPECIFIED]: "seal can’t be checked",
  [BrokenSeal.CHANGED]: "changed after it was sealed",
  [BrokenSeal.UNREADABLE_POSTMARK]: "postmark can’t be read",
  [BrokenSeal.UNREADABLE_LETTER]: "letter can’t be read",
};

const nameOf = (letter: ReadLetter) => letter.letter.path.slice(LETTERS_DIR.length + 1);

/** One line per letter, oldest first, each with its rows out of its own size's. */
function lettersText(letters: readonly ReadLetter[]): string {
  if (letters.length === 0) return `No letters in ${LETTERS_DIR}/.\n`;
  const rows = letters.map((l) => {
    const { state, rowsUsed, postmark, broken, path } = l.letter;
    let note = "";
    if (state === LetterState.BROKEN) note = `(${BROKEN_NOTE[broken]})`;
    else if (postmark) note = postmark.reason ? `${postmark.signer}: ${postmark.reason}` : postmark.signer;
    return [LETTER_STATE[state], `${rowsUsed}/${deskPage(sizeOfName(path)).rows}`, nameOf(l), note];
  });
  const width = (i: number) => Math.max(...rows.map((r) => (r[i] ?? "").length));
  return `${rows
    .map(([state = "", fit = "", name = "", note = ""]) =>
      `${state.padEnd(width(0))}  ${fit.padStart(width(1))}  ${name}${note ? `  ${note}` : ""}`.trimEnd(),
    )
    .join("\n")}\n`;
}

/**
 * What `a4 letters --latest` prints: the newest accepted letter's exact text,
 * then a note for each letter returned since; null when nothing can be delivered.
 */
export function latestText(letters: readonly ReadLetter[]): string | null {
  const delivery = latestDelivery(letters);
  if (!delivery) return null;
  let out = delivery.text;
  if (delivery.returnedSince.length > 0) {
    if (!out.endsWith("\n")) out += "\n";
    out += "\n---\n";
    for (const l of delivery.returnedSince) out += `Returned: ${nameOf(l)}: ${l.letter.postmark?.reason ?? ""}\n`;
  }
  return out;
}

/** The folder a command names, checked: it must exist and be a folder. */
export async function folderArg(folder: string): Promise<string> {
  const absolute = resolve(folder);
  const found = await stat(absolute).catch(() => null);
  if (!found) throw new UsageError(`“${folder}” doesn’t exist.`);
  if (!found.isDirectory()) throw new UsageError(`“${folder}” isn’t a folder.`);
  return absolute;
}

/** List a folder's letters, or deliver the latest accepted one. Always exits 0 once the folder is read. */
export async function runLetters(args: LettersArgs): Promise<number> {
  const read = await readLetters(nodeFolderSource.open(await folderArg(args.folder)));
  if (!args.latest) {
    process.stdout.write(
      args.json ? `${toJsonString(LetterListSchema, letterList(read), { prettySpaces: 2 })}\n` : lettersText(read),
    );
    return 0;
  }
  const out = latestText(read);
  if (out === null) {
    process.stderr.write(`a4: no accepted letter with an intact seal in “${args.folder}”.\n`);
    return 0;
  }
  process.stdout.write(out);
  return 0;
}
