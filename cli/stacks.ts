/**
 * `a4 stacks [folder] [--json]` lists a folder's stacks, and
 * `a4 stack <name> [folder] [--letter]` delivers one: its pages' exact text
 * in order, with the latest accepted letter on top (README, "Stacks"). Both
 * only read, make no network request, and exit 0 once the folder is read, so
 * a session-start hook never fails a session.
 */

import { toJsonString } from "@bufbuild/protobuf";
import {
  isStackName,
  LabelProblem,
  readLetters,
  readStack,
  readStacks,
  type StackReport,
  stackList,
  StackListSchema,
  STACKS_DIR,
} from "../lib/desk/index.ts";
import { LintOutcome, Unreadable } from "../lib/desk/lint.ts";
import { nodeFolderSource } from "../lib/persist/folder/fs-node.ts";
import { folderArg, latestText } from "./letters.ts";
import { UsageError } from "./usage.ts";

const OUTCOME: Record<LintOutcome, string> = {
  [LintOutcome.UNSPECIFIED]: "?",
  [LintOutcome.PASS]: "pass",
  [LintOutcome.WARN]: "warn",
  [LintOutcome.FAIL]: "fail",
};

const LABEL_PROBLEM: Record<LabelProblem, string> = {
  [LabelProblem.UNSPECIFIED]: "",
  [LabelProblem.MISSING]: "no label: stack.json is missing",
  [LabelProblem.UNREADABLE]: "no label: stack.json isn’t a stack label",
  [LabelProblem.NO_BUDGET]: "no budget: stack.json gives no page budget",
};

const UNREADABLE: Record<Unreadable, string> = {
  [Unreadable.UNSPECIFIED]: "can’t be read",
  [Unreadable.TOO_LARGE]: "is larger than 1 MiB",
  [Unreadable.NOT_UTF8]: "isn’t UTF-8 text",
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** A page's file name within its stack. */
const fileName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/** "1.75 of 3 pages", or "1.75 pages" without a budget. */
export function stackUse(report: StackReport): string {
  const budget = report.labelProblem === LabelProblem.UNSPECIFIED ? report.label?.budgetPages : undefined;
  return budget ? `${report.pagesUsed} of ${plural(budget, "page")}` : plural(report.pagesUsed, "page");
}

/** Every problem with a stack, most severe first: budget, pages over, unreadable pages, the label, lines said twice. */
export function stackProblems(report: StackReport): string[] {
  const problems: string[] = [];
  if (report.overByPages > 0) problems.push(`${plural(report.overByPages, "page")} over its budget`);
  for (const page of report.pages) {
    if (page.unreadable !== Unreadable.UNSPECIFIED)
      problems.push(`${fileName(page.path)} ${UNREADABLE[page.unreadable]}`);
    else if (page.rowsUsed > page.pageRows) {
      problems.push(`${fileName(page.path)} is ${plural(page.rowsUsed - page.pageRows, "row")} over its page`);
    }
  }
  if (report.labelProblem !== LabelProblem.UNSPECIFIED) problems.push(LABEL_PROBLEM[report.labelProblem]);
  for (const line of report.repeatedLines) {
    const where = line.pages.map((p, i) => `${fileName(p)}:${line.lines[i] ?? 0}`).join(" and ");
    problems.push(`a line repeats on ${where}`);
  }
  return problems;
}

/** A stack's line in a report: outcome, use, path, and its most severe problem. */
export function stackRow(report: StackReport, prefix = ""): [string, string, string, string] {
  const [first] = stackProblems(report);
  const path = `${prefix}${STACKS_DIR}/${report.name}/`;
  return [OUTCOME[report.outcome], stackUse(report), path, first ? ` — ${first}` : ""];
}

export interface StacksArgs {
  readonly folder: string;
  readonly json: boolean;
}

/** List a folder's stacks: one line each, then its problems. Exits 0. */
export async function runStacks(args: StacksArgs): Promise<number> {
  const stacks = await readStacks(nodeFolderSource.open(await folderArg(args.folder)));
  if (args.json) {
    process.stdout.write(`${toJsonString(StackListSchema, stackList(stacks), { prettySpaces: 2 })}\n`);
    return 0;
  }
  if (stacks.length === 0) {
    process.stdout.write(`No stacks in ${STACKS_DIR}/.\n`);
    return 0;
  }
  const rows = stacks.map(({ report }) => [OUTCOME[report.outcome], stackUse(report), report.name]);
  const width = (i: number) => Math.max(...rows.map((r) => (r[i] ?? "").length));
  const lines: string[] = [];
  stacks.forEach(({ report }, i) => {
    const [outcome = "", use = "", name = ""] = rows[i] ?? [];
    const purpose = report.label?.purpose ?? "";
    lines.push(`${outcome.padEnd(width(0))}  ${use.padStart(width(1))}  ${name}${purpose ? `  ${purpose}` : ""}`);
    for (const problem of stackProblems(report)) lines.push(`      - ${problem}`);
  });
  process.stdout.write(`${lines.join("\n")}\n`);
  return 0;
}

export interface StackArgs {
  readonly name: string;
  readonly folder: string;
  readonly letter: boolean;
}

/**
 * Deliver a stack: with `--letter`, first what `a4 letters --latest` prints;
 * then each page's exact text after a `--- <file name> ---` line. Problems go
 * to standard error, and a failing stack is still delivered.
 */
export async function runStack(args: StackArgs): Promise<number> {
  if (!isStackName(args.name)) throw new UsageError(`“${args.name}” isn’t a stack name.`);
  const fs = nodeFolderSource.open(await folderArg(args.folder));
  const stack = await readStack(fs, args.name);
  if (!stack) throw new UsageError(`The stack “${args.name}” doesn’t exist in ${STACKS_DIR}/.`);
  let out = "";
  if (args.letter) {
    const letter = latestText(await readLetters(fs));
    if (letter === null) process.stderr.write(`a4: no accepted letter with an intact seal to put on top.\n`);
    else out += letter.endsWith("\n") ? letter : `${letter}\n`;
  }
  stack.report.pages.forEach((page, i) => {
    const text = stack.texts[i];
    out += `--- ${fileName(page.path)} ---\n`;
    if (text !== null && text !== undefined) out += text.endsWith("\n") || text === "" ? text : `${text}\n`;
  });
  for (const problem of stackProblems(stack.report)) process.stderr.write(`a4: stack ${args.name}: ${problem}\n`);
  process.stdout.write(out);
  return 0;
}
