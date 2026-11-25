#!/usr/bin/env node
/**
 * a4: A4's desk on the command line.
 *
 *   pnpm a4 lint [path ...] [--strict] [--exclude <glob>]... [--json]
 *   pnpm a4 letters [folder] [--latest | --json]
 *   pnpm a4 mailroom [folder]
 *   node <checkout>/cli/a4.ts <command> ...
 *
 * `lint` checks agent context files and letters against the 80 × 60 Terminal
 * page, as the folder view lists and measures them (README, "Page lint").
 * `letters` lists a folder's letters, or with `--latest` prints the newest
 * accepted letter whose seal is intact (README, "Letters"). Both only read
 * files. `mailroom` serves the folder's letters to an agent over MCP on
 * standard input and output (cli/mailroom.ts; README, "Mailroom"); it writes
 * only new draft letters. None makes a network request.
 *
 * Exit status: 0 when nothing fails, 1 when lint finds a failing file, 2 for a
 * usage error or a path that can't be read.
 */

import { stat } from "node:fs/promises";
import { basename, dirname, matchesGlob, resolve, sep } from "node:path";
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";
import { toJsonString } from "@bufbuild/protobuf";
import { describeFinding, ENGLISH, formatByteLimit, VERDICT_LABEL } from "../components/analysis-copy.ts";
import type { Finding, Severity } from "../lib/analysis/index.ts";
import {
  BrokenSeal,
  DESK_PAGE,
  latestDelivery,
  LETTERS_DIR,
  letterList,
  LetterListSchema,
  LetterState,
  readLetters,
  type ReadLetter,
  MAX_FILE_BYTES,
  SCAN_ENTRY_LIMIT,
} from "../lib/desk/index.ts";
import {
  lintFailed,
  lintFile,
  lintFolder,
  LintOutcome,
  lintReport,
  LintReportSchema,
  type LintResult,
  Unreadable,
} from "../lib/desk/lint.ts";
import { nodeFolderSource } from "../lib/persist/folder/fs-node.ts";
import { createMailroom } from "./mailroom.ts";

const USAGE = `Usage: a4 lint [path ...] [--strict] [--exclude <glob>]... [--json]
       a4 letters [folder] [--latest | --json]
       a4 mailroom [folder]

a4 lint checks agent context files and letters against one A4 page
(${DESK_PAGE.cols} × ${DESK_PAGE.rows} cells). With no path, it checks the current folder and below:
AGENTS.md, CLAUDE.md, SKILL.md, the others the folder view lists, and the
letters in ${LETTERS_DIR}/. A file named on the command line is checked
whatever its name.
  --strict          Fail Noisy and Busy pages too, not only pages over ${DESK_PAGE.rows} rows
  --exclude <glob>  Skip files whose folder-relative path matches (repeatable)
  --json            Print an a4.v1.LintReport as JSON, and nothing else

a4 letters lists the letters in a folder's ${LETTERS_DIR}/ (the current folder
by default), oldest first, with their state, rows, signer, and reason.
  --latest          Print the newest accepted letter whose seal is intact, then a
                    note for each letter returned since. Prints nothing when no
                    letter can be delivered.
  --json            Print an a4.v1.LetterList as JSON (no letter text)

a4 mailroom serves a folder (the current folder by default) to an agent over
the Model Context Protocol, on standard input and output: lint_page checks a
page, write_letter files a new draft letter in ${LETTERS_DIR}/, and
read_letter returns the latest accepted letter. No tool seals a letter.
Register it with your agent rather than running it by hand.

  -h, --help        Show this help

Exit status: 0 when nothing fails, 1 when lint finds a failing file, 2 for a
usage error or a path that doesn't exist.
`;

/** A usage error or an unreadable path: exit status 2. */
class UsageError extends Error {}

const OUTCOME_LABEL: Record<LintOutcome, string> = {
  [LintOutcome.UNSPECIFIED]: "?",
  [LintOutcome.PASS]: "pass",
  [LintOutcome.WARN]: "warn",
  [LintOutcome.FAIL]: "fail",
};

const UNREADABLE_LABEL: Record<Unreadable, string> = {
  [Unreadable.UNSPECIFIED]: "",
  [Unreadable.TOO_LARGE]: `larger than ${formatByteLimit(MAX_FILE_BYTES)}`,
  [Unreadable.NOT_UTF8]: "not UTF-8 text",
};

const SEVERITY_RANK: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };

/** The most severe finding, the first of its severity in the analysis's order. */
function topFinding(findings: readonly Finding[]): Finding | undefined {
  let top: Finding | undefined;
  for (const f of findings) if (!top || SEVERITY_RANK[f.severity] < SEVERITY_RANK[top.severity]) top = f;
  return top;
}

/** A path for display and globs: "/"-separated, without a leading "./". */
function slashed(path: string): string {
  return path.split(sep).join("/").replace(/^\.\//, "");
}

interface LintArgs {
  readonly paths: readonly string[];
  readonly strict: boolean;
  readonly json: boolean;
  readonly exclude: readonly string[];
}

/** Lint each path: a folder's context files, or one file. */
async function lint(args: LintArgs): Promise<{ results: LintResult[]; partial: string[] }> {
  const results: LintResult[] = [];
  const partial: string[] = [];
  const exclude = (path: string) => args.exclude.some((glob) => matchesGlob(path, glob));
  for (const arg of args.paths) {
    const absolute = resolve(arg);
    const found = await stat(absolute).catch(() => null);
    if (!found) throw new UsageError(`“${arg}” doesn’t exist.`);
    if (found.isDirectory()) {
      const run = await lintFolder(nodeFolderSource.open(absolute), { strict: args.strict, exclude });
      const prefix = slashed(arg).replace(/\/+$/, "");
      for (const result of run.results) {
        const path = prefix === "" || prefix === "." ? result.file.path : `${prefix}/${result.file.path}`;
        result.file.path = path;
        results.push(result);
      }
      if (run.partial) partial.push(arg);
    } else if (found.isFile()) {
      const fs = nodeFolderSource.open(dirname(absolute));
      results.push(await lintFile(fs, basename(absolute), { strict: args.strict, label: slashed(arg) }));
    } else {
      throw new UsageError(`“${arg}” isn’t a file or a folder.`);
    }
  }
  return { results, partial };
}

/** One line per file, then a summary. */
function textReport(results: readonly LintResult[]): string {
  if (results.length === 0) return "No context files found.\n";
  const rows = results.map(({ file, judgment }) => {
    const outcome = OUTCOME_LABEL[file.outcome];
    if (!judgment) return [outcome, "–", UNREADABLE_LABEL[file.unreadable], file.path, ""];
    const finding = topFinding(judgment.analysis.assessment.findings);
    return [
      outcome,
      `${judgment.fit.rowsUsed}/${judgment.fit.pageRows}`,
      VERDICT_LABEL[judgment.analysis.assessment.verdict],
      file.path,
      finding ? ` — ${describeFinding(finding).title}` : "",
    ];
  });
  const width = (i: number) => Math.max(...rows.map((r) => (r[i] ?? "").length));
  const lines = rows.map(
    ([outcome = "", fit = "", verdict = "", path = "", note = ""]) =>
      `${outcome.padEnd(width(0))}  ${fit.padStart(width(1))}  ${verdict.padEnd(width(2))}  ${path}${note}`,
  );
  const count = (o: LintOutcome) => results.filter((r) => r.file.outcome === o).length;
  const n = results.length;
  lines.push(
    `${n} ${n === 1 ? "file" : "files"}: ${count(LintOutcome.FAIL)} failed, ${count(LintOutcome.WARN)} warned, ${count(LintOutcome.PASS)} passed.`,
  );
  return `${lines.join("\n")}\n`;
}

interface LettersArgs {
  readonly folder: string;
  readonly latest: boolean;
  readonly json: boolean;
}

type Command =
  | { readonly kind: "help" }
  | ({ readonly kind: "lint" } & LintArgs)
  | ({ readonly kind: "letters" } & LettersArgs)
  | { readonly kind: "mailroom"; readonly folder: string };

function parse(argv: readonly string[]): Command {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    strict: true,
    options: {
      json: { type: "boolean", default: false },
      strict: { type: "boolean", default: false },
      exclude: { type: "string", multiple: true, default: [] },
      latest: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  if (values.help) return { kind: "help" };
  const [command, ...paths] = positionals;
  if (command === "lint") {
    if (values.latest) throw new UsageError("--latest is an option of a4 letters.");
    return {
      kind: "lint",
      paths: paths.length > 0 ? paths : ["."],
      strict: values.strict,
      json: values.json,
      exclude: values.exclude,
    };
  }
  if (command === "letters") {
    if (values.strict || values.exclude.length > 0)
      throw new UsageError("--strict and --exclude are options of a4 lint.");
    if (paths.length > 1) throw new UsageError("a4 letters takes one folder.");
    if (values.latest && values.json) {
      throw new UsageError("--latest prints a letter’s text; --json lists letters. Choose one.");
    }
    return { kind: "letters", folder: paths[0] ?? ".", latest: values.latest, json: values.json };
  }
  if (command === "mailroom") {
    if (values.json || values.strict || values.latest || values.exclude.length > 0) {
      throw new UsageError("a4 mailroom takes no options.");
    }
    if (paths.length > 1) throw new UsageError("a4 mailroom takes one folder.");
    return { kind: "mailroom", folder: paths[0] ?? "." };
  }
  throw new UsageError(command ? `Unknown command “${command}”.` : "Name a command: lint, letters, or mailroom.");
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

/** One line per letter, oldest first. */
function lettersText(letters: readonly ReadLetter[]): string {
  if (letters.length === 0) return `No letters in ${LETTERS_DIR}/.\n`;
  const rows = letters.map((l) => {
    const { state, rowsUsed, postmark, broken } = l.letter;
    let note = "";
    if (state === LetterState.BROKEN) note = `(${BROKEN_NOTE[broken]})`;
    else if (postmark) note = postmark.reason ? `${postmark.signer}: ${postmark.reason}` : postmark.signer;
    return [LETTER_STATE[state], `${rowsUsed}/${DESK_PAGE.rows}`, nameOf(l), note];
  });
  const width = (i: number) => Math.max(...rows.map((r) => (r[i] ?? "").length));
  return `${rows
    .map(([state = "", fit = "", name = "", note = ""]) =>
      `${state.padEnd(width(0))}  ${fit.padStart(width(1))}  ${name}${note ? `  ${note}` : ""}`.trimEnd(),
    )
    .join("\n")}\n`;
}

/** List a folder's letters, or deliver the latest accepted one. Always exits 0 once the folder is read. */
async function letters(args: LettersArgs): Promise<number> {
  const absolute = resolve(args.folder);
  const found = await stat(absolute).catch(() => null);
  if (!found) throw new UsageError(`“${args.folder}” doesn’t exist.`);
  if (!found.isDirectory()) throw new UsageError(`“${args.folder}” isn’t a folder.`);
  const read = await readLetters(nodeFolderSource.open(absolute));
  if (!args.latest) {
    process.stdout.write(
      args.json ? `${toJsonString(LetterListSchema, letterList(read), { prettySpaces: 2 })}\n` : lettersText(read),
    );
    return 0;
  }
  const delivery = latestDelivery(read);
  if (!delivery) {
    process.stderr.write(`a4: no accepted letter with an intact seal in “${args.folder}”.\n`);
    return 0;
  }
  let out = delivery.text;
  if (delivery.returnedSince.length > 0) {
    if (!out.endsWith("\n")) out += "\n";
    out += "\n---\n";
    for (const l of delivery.returnedSince) out += `Returned: ${nameOf(l)}: ${l.letter.postmark?.reason ?? ""}\n`;
  }
  process.stdout.write(out);
  return 0;
}

/**
 * Serve a folder over MCP's stdio transport: one message per line in, one
 * response per line out, handled in order so writes never interleave.
 * Standard output carries protocol messages only. Exits 0 when input closes.
 */
async function mailroom(folder: string): Promise<number> {
  const absolute = resolve(folder);
  const found = await stat(absolute).catch(() => null);
  if (!found) throw new UsageError(`“${folder}” doesn’t exist.`);
  if (!found.isDirectory()) throw new UsageError(`“${folder}” isn’t a folder.`);
  const server = createMailroom({ fs: nodeFolderSource.open(absolute), now: () => Date.now() });
  const lines = createInterface({ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY });
  for await (const line of lines) {
    for (const response of await server.handle(line)) process.stdout.write(`${response}\n`);
  }
  return 0;
}

/** Report a failure: a usage error with the usage, anything else on its own. Exit status 2. */
function failed(error: unknown): number {
  if (error instanceof UsageError) process.stderr.write(`a4: ${error.message}\n\n${USAGE}`);
  else process.stderr.write(`a4: ${error instanceof Error ? error.message : String(error)}\n`);
  return 2;
}

async function main(argv: readonly string[]): Promise<number> {
  let args: Command;
  try {
    args = parse(argv);
  } catch (error) {
    // parseArgs reports unknown options and missing values as plain errors: those are usage errors too.
    return failed(
      error instanceof UsageError ? error : new UsageError(error instanceof Error ? error.message : String(error)),
    );
  }
  if (args.kind === "help") {
    process.stdout.write(USAGE);
    return 0;
  }
  if (args.kind === "letters") {
    try {
      return await letters(args);
    } catch (error) {
      return failed(error);
    }
  }
  if (args.kind === "mailroom") {
    try {
      return await mailroom(args.folder);
    } catch (error) {
      return failed(error);
    }
  }
  let run: Awaited<ReturnType<typeof lint>>;
  try {
    run = await lint(args);
  } catch (error) {
    return failed(error);
  }
  for (const folder of run.partial) {
    process.stderr.write(
      `a4: stopped after ${ENGLISH.count(SCAN_ENTRY_LIMIT)} entries in “${folder}”; some files may not be checked.\n`,
    );
  }
  if (args.json) {
    const report = lintReport(run.results, { partial: run.partial.length > 0, strict: args.strict });
    process.stdout.write(`${toJsonString(LintReportSchema, report, { prettySpaces: 2 })}\n`);
  } else {
    process.stdout.write(textReport(run.results));
  }
  return lintFailed(run.results) ? 1 : 0;
}

process.exitCode = await main(process.argv.slice(2));
