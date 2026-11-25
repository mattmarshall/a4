/**
 * The desk's records in English: letter states and broken seals, lint
 * outcomes, files that can't be read, and stacks. The app, the `a4` command,
 * and the mailroom all say these things, so they say them the same way.
 *
 * Like analysis-copy.ts, it imports lib/ by relative path, so the `a4`
 * command can load it under Node without the app's path aliases.
 */

import { BrokenSeal, LabelProblem, LetterState, LintOutcome, type StackReport, Unreadable } from "../lib/desk/index.ts";

/** A lint or stack outcome, as one word. */
export const OUTCOME_WORD: Readonly<Record<LintOutcome, string>> = {
  [LintOutcome.UNSPECIFIED]: "?",
  [LintOutcome.PASS]: "pass",
  [LintOutcome.WARN]: "warn",
  [LintOutcome.FAIL]: "fail",
};

/** Why a file can't be read, as a predicate: "the file is …". */
export const UNREADABLE_WORDS: Readonly<Record<Unreadable, string>> = {
  [Unreadable.UNSPECIFIED]: "",
  [Unreadable.TOO_LARGE]: "larger than 1 MiB",
  [Unreadable.NOT_UTF8]: "not UTF-8 text",
};

/** A letter's state, as the Letters group and `a4 letters` name it. */
export const LETTER_STATE_LABEL: Readonly<Record<LetterState, string>> = {
  [LetterState.UNSPECIFIED]: "Letter",
  [LetterState.DRAFT]: "Draft",
  [LetterState.ACCEPTED]: "Accepted",
  [LetterState.RETURNED]: "Returned",
  [LetterState.BROKEN]: "Broken seal",
};

/** Why a seal is broken, as a predicate: "the letter …". */
export const BROKEN_SEAL_REASON: Readonly<Record<BrokenSeal, string>> = {
  [BrokenSeal.UNSPECIFIED]: "has a seal that can’t be checked",
  [BrokenSeal.CHANGED]: "changed after it was sealed",
  [BrokenSeal.UNREADABLE_POSTMARK]: "has a postmark that can’t be read",
  [BrokenSeal.UNREADABLE_LETTER]: "can’t be read",
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** A page's file name within its stack. */
const fileName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/** "1.75 of 3 pages", or "1.75 pages" without a budget. */
export function stackUse(stack: StackReport): string {
  const budget = stack.labelProblem === LabelProblem.UNSPECIFIED ? stack.label?.budgetPages : undefined;
  return budget ? `${stack.pagesUsed} of ${plural(budget, "page")}` : plural(stack.pagesUsed, "page");
}

const LABEL_PROBLEM: Readonly<Record<LabelProblem, string>> = {
  [LabelProblem.UNSPECIFIED]: "",
  [LabelProblem.MISSING]: "no label: stack.json is missing",
  [LabelProblem.UNREADABLE]: "no label: stack.json isn’t a stack label",
  [LabelProblem.NO_BUDGET]: "no budget: stack.json gives no page budget",
};

/**
 * Every problem with a stack, most severe first: its budget, pages over their
 * size or unreadable, its label, and lines said twice. Each starts lowercase,
 * for a list; capitalize one to show it alone.
 */
export function stackProblems(stack: StackReport): string[] {
  const problems: string[] = [];
  if (stack.overByPages > 0) problems.push(`${plural(stack.overByPages, "page")} over its budget`);
  for (const page of stack.pages) {
    if (page.unreadable !== Unreadable.UNSPECIFIED) {
      problems.push(`${fileName(page.path)} is ${UNREADABLE_WORDS[page.unreadable]}`);
    } else if (page.rowsUsed > page.pageRows) {
      problems.push(`${fileName(page.path)} is ${plural(page.rowsUsed - page.pageRows, "row")} over its page`);
    }
  }
  if (stack.labelProblem !== LabelProblem.UNSPECIFIED) problems.push(LABEL_PROBLEM[stack.labelProblem]);
  for (const line of stack.repeatedLines) {
    const where = line.pages.map((p, i) => `${fileName(p)}:${line.lines[i] ?? 0}`).join(" and ");
    problems.push(`a line repeats on ${where}`);
  }
  return problems;
}
