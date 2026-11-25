/**
 * Page lint: check context files against the page and report each one as an
 * `a4.v1.LintedFile`. A folder is walked exactly as the folder view walks it
 * (`walkFolder`, then `isContextFile`), and each file is measured as the
 * folder view shows it on the sheet. Nothing here writes a file.
 */

import { create } from "@bufbuild/protobuf";
import {
  type LintedFile,
  LintedFileSchema,
  LintOutcome,
  type LintReport,
  LintReportSchema,
  Unreadable,
} from "../gen/a4/v1/lint_pb.js";
import type { FolderFs } from "../persist/folder/fs.ts";
import { isContextFile } from "../persist/folder/scan.ts";
import { decodeStrict, MAX_FILE_BYTES, SCAN_ENTRY_LIMIT, walkFolder } from "../persist/store/folder.ts";
import { DESK_PAGE, judgeFile, type Judgment, type Outcome, outcomeOf } from "./judge.ts";

export type { LintedFile, LintReport } from "../gen/a4/v1/lint_pb.js";
export { LintedFileSchema, LintOutcome, LintReportSchema, Unreadable } from "../gen/a4/v1/lint_pb.js";

const OUTCOME: Record<Outcome, LintOutcome> = {
  pass: LintOutcome.PASS,
  warn: LintOutcome.WARN,
  fail: LintOutcome.FAIL,
};

/** One linted file: its report entry, and the judgment behind it when the file could be read. */
export interface LintResult {
  readonly file: LintedFile;
  readonly judgment: Judgment | null;
}

export interface LintOptions {
  /** Fail Noisy and Busy pages too, not just overflowing ones. */
  readonly strict?: boolean;
}

/**
 * Lint the file at `path` in `fs`. `label` is the path to report (default:
 * `path`). A file over 1 MiB or not UTF-8 fails with its reason.
 * @throws FsError("not-found") when the file doesn't exist
 */
export async function lintFile(
  fs: FolderFs,
  path: string,
  options: LintOptions & { readonly label?: string } = {},
): Promise<LintResult> {
  const label = options.label ?? path;
  const { bytes } = await fs.readBytes(path, { maxBytes: MAX_FILE_BYTES });
  if (bytes === null) return unreadable(label, Unreadable.TOO_LARGE);
  const text = decodeStrict(bytes);
  if (text === null) return unreadable(label, Unreadable.NOT_UTF8);
  const judgment = judgeFile(text);
  const file = create(LintedFileSchema, {
    path: label,
    outcome: OUTCOME[outcomeOf(judgment, options)],
    report: judgment.report,
  });
  return { file, judgment };
}

function unreadable(path: string, reason: Unreadable): LintResult {
  return { file: create(LintedFileSchema, { path, outcome: LintOutcome.FAIL, unreadable: reason }), judgment: null };
}

export interface LintFolderOptions extends LintOptions {
  /** Leave out a context file whose folder-relative path (with "/") matches. */
  readonly exclude?: (path: string) => boolean;
  /** Stop the walk after this many entries (default: the folder view's 20,000). */
  readonly limit?: number;
}

export interface FolderLint {
  /** One per context file, sorted by path. */
  readonly results: readonly LintResult[];
  /** True when the walk stopped at its entry limit. */
  readonly partial: boolean;
}

/** Lint every context file in `fs`. */
export async function lintFolder(fs: FolderFs, options: LintFolderOptions = {}): Promise<FolderLint> {
  const walk = await walkFolder(fs, options.limit ?? SCAN_ENTRY_LIMIT);
  const paths = walk.files
    .filter((path) => isContextFile(path) && !options.exclude?.(path))
    // By code unit, not locale, so the order is the same on every machine.
    .sort((a, b) => Number(a > b) - Number(a < b));
  const results: LintResult[] = [];
  for (const path of paths) {
    try {
      results.push(await lintFile(fs, path, options));
    } catch {
      // Gone since the walk, as the folder view treats it.
    }
  }
  return { results, partial: walk.partial };
}

/** The `a4.v1.LintReport` for `results`, judged on the desk's page. */
export function lintReport(
  results: readonly LintResult[],
  options: { readonly partial: boolean; readonly strict: boolean },
): LintReport {
  return create(LintReportSchema, {
    preset: DESK_PAGE.id,
    files: results.map((r) => r.file),
    partial: options.partial,
    strict: options.strict,
  });
}

/** True when any file failed. */
export function lintFailed(results: readonly LintResult[]): boolean {
  return results.some((r) => r.file.outcome === LintOutcome.FAIL);
}
