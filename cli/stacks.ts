/**
 * `a4 stacks [folder] [--json]` lists a folder's stacks, and
 * `a4 stack <name> [folder] [--letter]` delivers one: its pages' exact text
 * in order, with the latest accepted letter on top (README, "Stacks"). Both
 * only read, make no network request, and exit 0 once the folder is read, so
 * a session-start hook never fails a session.
 */

import { toJsonString } from "@bufbuild/protobuf";
import { OUTCOME_WORD, stackProblems, stackUse } from "../components/desk-copy.ts";
import {
  isStackName,
  readLetters,
  readStack,
  readStacks,
  type StackReport,
  stackList,
  StackListSchema,
  STACKS_DIR,
} from "../lib/desk/index.ts";
import { nodeFolderSource } from "../lib/persist/folder/fs-node.ts";
import { folderArg, latestText } from "./letters.ts";
import { UsageError } from "./usage.ts";

/** A page's file name within its stack. */
const fileName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/** A stack's line in a report: outcome, use, path, and its most severe problem. */
export function stackRow(report: StackReport, prefix = ""): [string, string, string, string] {
  const [first] = stackProblems(report);
  const path = `${prefix}${STACKS_DIR}/${report.name}/`;
  return [OUTCOME_WORD[report.outcome], stackUse(report), path, first ? ` — ${first}` : ""];
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
  const rows = stacks.map(({ report }) => [OUTCOME_WORD[report.outcome], stackUse(report), report.name]);
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
