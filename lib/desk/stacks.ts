/**
 * Stacks: piles of pages with a page budget in a folder's `.agents/stacks/`.
 * A stack is a folder, `.agents/stacks/<name>/`; its pages are the `.md`
 * files directly inside it, in name order, and its label is `stack.json`
 * (`a4.v1.StackLabel`). A sheet lies on one stack only, so each page is
 * written for its stack's reader, and the desk can judge the stack as a whole:
 * its budget, its pages on their own sizes, and the lines said twice.
 *
 * The app's folder view lists stacks with these functions, and the `a4`
 * command lists, lints, and delivers them, so both agree. Runtime-agnostic:
 * it takes a `FolderFs`.
 */

import { create, fromJsonString } from "@bufbuild/protobuf";
import {
  LabelProblem,
  LintOutcome,
  RepeatedLineSchema,
  type StackList,
  StackListSchema,
  type StackPage,
  StackPageSchema,
  type StackReport,
  StackReportSchema,
  Unreadable,
} from "../gen/a4/v1/lint_pb.js";
import { type StackLabel, StackLabelSchema } from "../gen/a4/v1/stack_pb.js";
import { type PaperId, sizeOfName } from "../page/index.ts";
import { FsError, type FolderFs } from "../persist/folder/fs.ts";
import { isStackName, STACKS_DIR } from "../persist/folder/scan.ts";
import { decodeStrict, MAX_FILE_BYTES } from "../persist/store/folder.ts";
import { paperEnum } from "../tensor/record.ts";
import { judgeFile, outcomeOf, type Outcome } from "./judge.ts";
import { compareLetterNames } from "./letters.ts";

export type { StackList, StackReport } from "../gen/a4/v1/lint_pb.js";
export { LabelProblem, LintOutcome, StackListSchema, Unreadable } from "../gen/a4/v1/lint_pb.js";
export { isStackName, STACKS_DIR } from "../persist/folder/scan.ts";

/** A stack's label file, beside its pages. */
const LABEL_FILE = "stack.json";

/** A label file's size limit; a real one is a few lines. */
const MAX_LABEL_BYTES = 64 * 1024;

/** Each paper in quarter pages: sums stay exact (0.25, 0.5, 0.75 …). */
const QUARTERS: Readonly<Record<PaperId, number>> = { a4: 4, a5: 2, a6: 1 };

/** The shortest line, once trimmed, that counts as said twice when it's on two pages. */
const REPEATED_LINE_MIN = 20;

const OUTCOME: Readonly<Record<Outcome, LintOutcome>> = {
  pass: LintOutcome.PASS,
  warn: LintOutcome.WARN,
  fail: LintOutcome.FAIL,
};

/** A stack as read: its report, and each page's text (null when it can't be read), in stack order. */
export interface ReadStack {
  readonly report: StackReport;
  readonly texts: readonly (string | null)[];
}

/** The folder a stack's pages and label live in. */
function stackDir(name: string): string {
  return `${STACKS_DIR}/${name}`;
}

async function readLabel(fs: FolderFs, name: string): Promise<{ label?: StackLabel; problem: LabelProblem }> {
  const path = `${stackDir(name)}/${LABEL_FILE}`;
  if (!(await fs.stat(path))) return { problem: LabelProblem.MISSING };
  const { bytes } = await fs.readBytes(path, { maxBytes: MAX_LABEL_BYTES });
  const json = bytes ? decodeStrict(bytes) : null;
  if (json === null) return { problem: LabelProblem.UNREADABLE };
  try {
    const label = fromJsonString(StackLabelSchema, json, { ignoreUnknownFields: true });
    return { label, problem: label.budgetPages > 0 ? LabelProblem.UNSPECIFIED : LabelProblem.NO_BUDGET };
  } catch {
    return { problem: LabelProblem.UNREADABLE };
  }
}

async function readPage(fs: FolderFs, path: string): Promise<{ page: StackPage; text: string | null }> {
  const paper = sizeOfName(path);
  const base = { path, paper: paperEnum(paper) };
  const { bytes } = await fs.readBytes(path, { maxBytes: MAX_FILE_BYTES });
  if (bytes === null) {
    return {
      page: create(StackPageSchema, { ...base, outcome: LintOutcome.FAIL, unreadable: Unreadable.TOO_LARGE }),
      text: null,
    };
  }
  const text = decodeStrict(bytes);
  if (text === null) {
    return {
      page: create(StackPageSchema, { ...base, outcome: LintOutcome.FAIL, unreadable: Unreadable.NOT_UTF8 }),
      text: null,
    };
  }
  const judgment = judgeFile(text, paper);
  const page = create(StackPageSchema, {
    ...base,
    rowsUsed: judgment.fit.rowsUsed,
    pageRows: judgment.fit.pageRows,
    outcome: OUTCOME[outcomeOf(judgment)],
    report: judgment.report,
  });
  return { page, text };
}

/** Lines of at least 20 characters, once trimmed, found on two or more pages: by position, never by text. */
function repeatedLines(pages: readonly StackPage[], texts: readonly (string | null)[]) {
  const seen = new Map<string, { page: number; line: number }[]>();
  texts.forEach((text, page) => {
    if (text === null) return;
    const onThisPage = new Set<string>();
    text.split(/\r\n|\r|\n/).forEach((raw, i) => {
      const line = raw.trim();
      if (line.length < REPEATED_LINE_MIN || onThisPage.has(line)) return;
      onThisPage.add(line);
      const at = seen.get(line) ?? [];
      at.push({ page, line: i + 1 });
      seen.set(line, at);
    });
  });
  return [...seen.values()]
    .filter((at) => at.length > 1)
    .map((at) =>
      create(RepeatedLineSchema, {
        pages: at.map((a) => pages[a.page]?.path ?? ""),
        lines: at.map((a) => a.line),
      }),
    );
}

/** Read and judge the stack `name`, or null when its folder doesn't exist. */
export async function readStack(fs: FolderFs, name: string): Promise<ReadStack | null> {
  const dir = stackDir(name);
  const names: string[] = [];
  try {
    for await (const entry of fs.entries(dir)) {
      if (entry.kind === "file" && entry.name.length > 3 && entry.name.toLowerCase().endsWith(".md")) {
        names.push(entry.name);
      }
    }
  } catch (error) {
    if (error instanceof FsError && error.code === "not-found") return null;
    throw error;
  }
  names.sort(compareLetterNames);
  const { label, problem } = await readLabel(fs, name);
  const pages: StackPage[] = [];
  const texts: (string | null)[] = [];
  for (const file of names) {
    try {
      const read = await readPage(fs, `${dir}/${file}`);
      pages.push(read.page);
      texts.push(read.text);
    } catch (error) {
      // Gone since the listing.
      if (!(error instanceof FsError && error.code === "not-found")) throw error;
    }
  }
  const quarters = pages.reduce((sum, p) => sum + QUARTERS[sizeOfName(p.path)], 0);
  const budget = problem === LabelProblem.UNSPECIFIED ? (label?.budgetPages ?? 0) : 0;
  const overQuarters = budget > 0 ? Math.max(0, quarters - budget * 4) : 0;
  const repeated = repeatedLines(pages, texts);
  const pageFailed = pages.some((p) => p.outcome === LintOutcome.FAIL);
  let outcome = LintOutcome.PASS;
  if (overQuarters > 0 || pageFailed) outcome = LintOutcome.FAIL;
  else if (problem !== LabelProblem.UNSPECIFIED || repeated.length > 0) outcome = LintOutcome.WARN;
  const report = create(StackReportSchema, {
    name,
    labelProblem: problem,
    pages,
    pagesUsed: quarters / 4,
    overByPages: overQuarters / 4,
    outcome,
    repeatedLines: repeated,
    ...(label ? { label } : {}),
  });
  return { report, texts };
}

/** Every stack in `fs`, in name order. A folder without `.agents/stacks/` has none. */
export async function readStacks(fs: FolderFs): Promise<ReadStack[]> {
  const names: string[] = [];
  try {
    for await (const entry of fs.entries(STACKS_DIR)) {
      if (entry.kind === "directory" && isStackName(entry.name)) names.push(entry.name);
    }
  } catch (error) {
    if (error instanceof FsError && error.code === "not-found") return [];
    throw error;
  }
  names.sort((a, b) => Number(a > b) - Number(a < b));
  const stacks: ReadStack[] = [];
  for (const name of names) {
    const stack = await readStack(fs, name);
    if (stack) stacks.push(stack);
  }
  return stacks;
}

/** The list `a4 stacks --json` prints: every stack's report, without any page's text. */
export function stackList(stacks: readonly ReadStack[], partial = false): StackList {
  return create(StackListSchema, { stacks: stacks.map((s) => s.report), partial });
}
