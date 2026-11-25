/**
 * The headless desk: A4's judgment of a page without a browser, for the `a4`
 * command and, later, letters and the mailroom (docs/platform.md). It judges
 * on the canonical Terminal page with the one fit rule the sheet, the
 * analysis, and the model host share, and lints context files the way the
 * folder view lists and measures them.
 *
 * Runtime-agnostic: it takes a `FolderFs` and imports no DOM or Node API. The
 * caller supplies the folder (the CLI uses lib/persist/folder/fs-node.ts).
 */

export { MAX_FILE_BYTES, SCAN_ENTRY_LIMIT } from "../persist/store/folder.ts";
export {
  BrokenSeal,
  compareLetterNames,
  type Delivery,
  isLetterPath,
  latestDelivery,
  type Letter,
  letterDigest,
  type LetterList,
  letterList,
  LetterListSchema,
  letterPathAt,
  LETTERS_DIR,
  LetterState,
  LetterVerdict,
  type Postmark,
  PostmarkExistsError,
  postmarkJson,
  postmarkPath,
  PostmarkSchema,
  type ReadLetter,
  readLetters,
  sealLetter,
  type SealOptions,
  type SealRefusal,
  SealRefusedError,
} from "./letters.ts";
export { DESK_PAGE, judge, judgeFile, type Judgment, type Outcome, outcomeOf } from "./judge.ts";
// Lint (./lint.ts) isn't re-exported: only the a4 command uses it, and it
// imports lint.ts directly, so the app's first load doesn't carry it.
