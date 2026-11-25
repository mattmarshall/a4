#!/usr/bin/env node
/**
 * a4: A4's desk on the command line.
 *
 *   pnpm a4 lint [path ...] [--strict] [--exclude <glob>]... [--json]
 *   node <checkout>/cli/a4.ts lint ...
 *
 * `lint` checks agent context files against the 80 × 60 Terminal page, as the
 * folder view lists and measures them (README, "Page lint"). It only reads
 * files and makes no network request.
 *
 * Exit status: 0 when no file fails, 1 when one does, 2 for a usage error or
 * a path that can't be read.
 */

import { stat } from "node:fs/promises";
import { basename, dirname, matchesGlob, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import { toJsonString } from "@bufbuild/protobuf";
import { describeFinding, ENGLISH, formatByteLimit, VERDICT_LABEL } from "../components/analysis-copy.ts";
import type { Finding, Severity } from "../lib/analysis/index.ts";
import {
  DESK_PAGE,
  lintFailed,
  lintFile,
  lintFolder,
  LintOutcome,
  lintReport,
  LintReportSchema,
  type LintResult,
  MAX_FILE_BYTES,
  SCAN_ENTRY_LIMIT,
  Unreadable,
} from "../lib/desk/index.ts";
import { nodeFolderSource } from "../lib/persist/folder/fs-node.ts";

const USAGE = `Usage: a4 lint [path ...] [options]

Check agent context files against one A4 page (${DESK_PAGE.cols} × ${DESK_PAGE.rows} cells).
With no path, checks the context files in the current folder and below:
AGENTS.md, CLAUDE.md, SKILL.md, and the others the folder view lists.
A file named on the command line is checked whatever its name.

Options:
  --strict          Fail Noisy and Busy pages too, not only pages over ${DESK_PAGE.rows} rows
  --exclude <glob>  Skip files whose folder-relative path matches (repeatable)
  --json            Print an a4.v1.LintReport as JSON, and nothing else
  -h, --help        Show this help

Exit status: 0 when no file fails, 1 when one does, 2 for a usage error.
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

function parse(argv: readonly string[]): { help: true } | ({ help: false } & LintArgs) {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    strict: true,
    options: {
      json: { type: "boolean", default: false },
      strict: { type: "boolean", default: false },
      exclude: { type: "string", multiple: true, default: [] },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  if (values.help) return { help: true };
  const [command, ...paths] = positionals;
  if (command !== "lint") throw new UsageError(command ? `Unknown command “${command}”.` : "Name a command: lint.");
  return {
    help: false,
    paths: paths.length > 0 ? paths : ["."],
    strict: values.strict,
    json: values.json,
    exclude: values.exclude,
  };
}

async function main(argv: readonly string[]): Promise<number> {
  let args: ReturnType<typeof parse>;
  try {
    args = parse(argv);
  } catch (error) {
    process.stderr.write(`a4: ${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`);
    return 2;
  }
  if (args.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  let run: Awaited<ReturnType<typeof lint>>;
  try {
    run = await lint(args);
  } catch (error) {
    if (error instanceof UsageError) {
      process.stderr.write(`a4: ${error.message}\n\n${USAGE}`);
    } else {
      process.stderr.write(`a4: ${error instanceof Error ? error.message : String(error)}\n`);
    }
    return 2;
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
