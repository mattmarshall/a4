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
export { DESK_PAGE, judge, judgeFile, type Judgment, type Outcome, outcomeOf } from "./judge.ts";
export {
  type FolderLint,
  type LintedFile,
  LintedFileSchema,
  lintFailed,
  lintFile,
  lintFolder,
  type LintFolderOptions,
  type LintOptions,
  LintOutcome,
  type LintReport,
  lintReport,
  LintReportSchema,
  type LintResult,
  Unreadable,
} from "./lint.ts";
