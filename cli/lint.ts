/**
 * `a4 lint [path ...] [--strict] [--exclude <glob>]... [--json]`: check agent
 * context files, letters, and stack pages against the page, each on its own
 * size, as the folder view lists and measures them, and judge each stack as a
 * whole (README, "Page lint"). Only reads, and makes no network request.
 */

import { stat } from "node:fs/promises";
import { basename, dirname, matchesGlob, resolve } from "node:path";
import { toJsonString } from "@bufbuild/protobuf";
import { describeFinding, ENGLISH, formatByteLimit, VERDICT_LABEL } from "../components/analysis-copy.ts";
import type { Finding, Severity } from "../lib/analysis/index.ts";
import { MAX_FILE_BYTES, SCAN_ENTRY_LIMIT, type StackReport } from "../lib/desk/index.ts";
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
import { stackRow } from "./stacks.ts";
import { slashed, UsageError } from "./usage.ts";

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

export interface LintArgs {
  readonly paths: readonly string[];
  readonly strict: boolean;
  readonly json: boolean;
  readonly exclude: readonly string[];
}

interface LintRun {
  readonly results: LintResult[];
  /** Each scanned folder's stacks, with the folder's prefix for display. */
  readonly stacks: { readonly report: StackReport; readonly prefix: string }[];
  readonly partial: string[];
}

/** Lint each path: a folder's context files, letters, stack pages, and stacks, or one file. */
async function lint(args: LintArgs): Promise<LintRun> {
  const results: LintResult[] = [];
  const stacks: LintRun["stacks"] = [];
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
      for (const report of run.stacks)
        stacks.push({ report, prefix: prefix === "" || prefix === "." ? "" : `${prefix}/` });
      if (run.partial) partial.push(arg);
    } else if (found.isFile()) {
      const fs = nodeFolderSource.open(dirname(absolute));
      results.push(await lintFile(fs, basename(absolute), { strict: args.strict, label: slashed(arg) }));
    } else {
      throw new UsageError(`“${arg}” isn’t a file or a folder.`);
    }
  }
  return { results, stacks, partial };
}

/** One line per file, then one per stack, then a summary. */
function textReport(results: readonly LintResult[], stacks: LintRun["stacks"]): string {
  if (results.length === 0 && stacks.length === 0) return "No context files found.\n";
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
  const stackRows = stacks.map(({ report, prefix }) => stackRow(report, prefix));
  const stackWidth = (i: number) => Math.max(...stackRows.map((r) => (r[i] ?? "").length));
  for (const [outcome, use, path, note] of stackRows) {
    lines.push(`${outcome.padEnd(stackWidth(0))}  ${use.padStart(stackWidth(1))}  ${path}${note}`);
  }
  const count = (o: LintOutcome) => results.filter((r) => r.file.outcome === o).length;
  const n = results.length;
  lines.push(
    `${n} ${n === 1 ? "file" : "files"}: ${count(LintOutcome.FAIL)} failed, ${count(LintOutcome.WARN)} warned, ${count(LintOutcome.PASS)} passed.`,
  );
  if (stacks.length > 0) {
    const counted = (o: LintOutcome) => stacks.filter((s) => s.report.outcome === o).length;
    const m = stacks.length;
    lines.push(
      `${m} ${m === 1 ? "stack" : "stacks"}: ${counted(LintOutcome.FAIL)} failed, ${counted(LintOutcome.WARN)} warned, ${counted(LintOutcome.PASS)} passed.`,
    );
  }
  return `${lines.join("\n")}\n`;
}

/** Lint, print the report, and return the exit status: 1 when a file or stack fails. */
export async function runLint(args: LintArgs): Promise<number> {
  const run = await lint(args);
  for (const folder of run.partial) {
    process.stderr.write(
      `a4: stopped after ${ENGLISH.count(SCAN_ENTRY_LIMIT)} entries in “${folder}”; some files may not be checked.\n`,
    );
  }
  const stacks = run.stacks.map((s) => s.report);
  if (args.json) {
    const report = lintReport(run.results, { partial: run.partial.length > 0, strict: args.strict, stacks });
    process.stdout.write(`${toJsonString(LintReportSchema, report, { prettySpaces: 2 })}\n`);
  } else {
    process.stdout.write(textReport(run.results, run.stacks));
  }
  return lintFailed(run.results, stacks) ? 1 : 0;
}
