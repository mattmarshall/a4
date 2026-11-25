import { test } from "node:test";
import assert from "node:assert/strict";
import { toJsonString } from "@bufbuild/protobuf";
import { ANALYSIS_TEXTS } from "../analysis/testing/texts.ts";
import { fileRows } from "../persist/folder/scan.ts";
import { browserFixture, nodeFixture, type FolderFixture } from "../persist/folder/testing/fixtures.ts";
import {
  judge,
  judgeFile,
  lintFailed,
  lintFile,
  lintFolder,
  type LintFolderOptions,
  LintOutcome,
  lintReport,
  LintReportSchema,
  outcomeOf,
  Unreadable,
} from "./index.ts";

const lines = (n: number) =>
  `${Array.from({ length: n }, (_, i) => `Line ${i + 1} of the agent context.`).join("\n")}\n`;

/** A known text and the verdict the analysis gives it on the Terminal page. */
function text(name: keyof typeof ANALYSIS_TEXTS, verdict: string): string {
  const t = ANALYSIS_TEXTS[name];
  assert.equal(judge(t).analysis.assessment.verdict, verdict, `${name} is ${verdict}`);
  return t;
}

test("judgeFile measures a file as the folder view does: tabs as two spaces, CRLF as LF", () => {
  const raw = Array.from({ length: 70 }, (_, i) => `\tStep ${i + 1}: check the deploy.`).join("\r\n");
  const judgment = judgeFile(raw);
  assert.equal(judgment.fit.rowsUsed, fileRows(raw));
  assert.equal(judgment.fit.rowsUsed, 70);
  assert.equal(judgment.fit.overBy, 10);
  assert.equal(judgment.report.metrics?.rowsUsed, 70);
  assert.equal(judgment.report.preset, "terminal");
});

test("outcomeOf: an overflowing page fails in both modes", () => {
  const overflowing = judge(text("overflow", "overflowing"));
  assert.equal(outcomeOf(overflowing), "fail");
  assert.equal(outcomeOf(overflowing, { strict: true }), "fail");
});

test("outcomeOf: Noisy and Busy warn, or fail with strict", () => {
  for (const page of [judge(text("noisy-json", "noisy")), judge(text("wall", "busy"))]) {
    assert.equal(outcomeOf(page), "warn");
    assert.equal(outcomeOf(page, { strict: true }), "fail");
  }
});

test("outcomeOf: Empty, Light, and Balanced always pass", () => {
  for (const [name, verdict] of [
    ["empty", "empty"],
    ["light", "light"],
    ["welcome", "balanced"],
  ] as const) {
    const page = judge(text(name, verdict));
    assert.equal(outcomeOf(page), "pass", name);
    assert.equal(outcomeOf(page, { strict: true }), "pass", name);
  }
});

/** The lint tests, on one folder adapter. */
function suite<H>(label: string, makeFixture: () => Promise<FolderFixture<H>>) {
  const inFolder = async <T>(
    files: Record<string, string | Uint8Array>,
    run: (fs: ReturnType<FolderFixture<H>["source"]["open"]>) => Promise<T>,
  ): Promise<T> => {
    const fixture = await makeFixture();
    try {
      const folder = await fixture.folder("repo", files);
      return await run(fixture.source.open(folder.handle));
    } finally {
      await fixture.dispose();
    }
  };
  const lintAll = (files: Record<string, string | Uint8Array>, options?: LintFolderOptions) =>
    inFolder(files, async (fs) => {
      const run = await lintFolder(fs, options);
      const report = lintReport(run.results, { partial: run.partial, strict: options?.strict ?? false });
      return { report, failed: lintFailed(run.results), results: run.results };
    });

  test(`${label}: a file over 1 MiB fails as too large`, async () => {
    const { file, judgment } = await inFolder({ "CLAUDE.md": "x".repeat(1_048_577) }, (fs) =>
      lintFile(fs, "CLAUDE.md"),
    );
    assert.equal(judgment, null);
    assert.equal(file.outcome, LintOutcome.FAIL);
    assert.equal(file.unreadable, Unreadable.TOO_LARGE);
    assert.equal(file.report, undefined);
  });

  test(`${label}: a file that isn't UTF-8 fails as not UTF-8`, async () => {
    const { file } = await inFolder({ "CLAUDE.md": new Uint8Array([0x48, 0x69, 0xff, 0xfe]) }, (fs) =>
      lintFile(fs, "CLAUDE.md"),
    );
    assert.equal(file.outcome, LintOutcome.FAIL);
    assert.equal(file.unreadable, Unreadable.NOT_UTF8);
  });

  test(`${label}: the report never carries the file's text`, async () => {
    const { report } = await lintAll({ "CLAUDE.md": `${lines(5)}token: sk-test-123\n` });
    assert.equal(report.files.length, 1);
    assert.ok(!toJsonString(LintReportSchema, report).includes("sk-test-123"));
  });

  test(`${label}: lists context files at any depth and skips other Markdown and skipped folders`, async () => {
    const { report, failed, results } = await lintAll({
      "AGENTS.md": lines(74),
      ".claude/skills/review/SKILL.md": ANALYSIS_TEXTS.light,
      "README.md": lines(3),
      "node_modules/pkg/AGENTS.md": lines(3),
    });
    assert.deepEqual(
      report.files.map((f) => f.path),
      [".claude/skills/review/SKILL.md", "AGENTS.md"],
    );
    const agents = report.files[1];
    assert.equal(agents?.outcome, LintOutcome.FAIL);
    assert.equal(agents?.report?.metrics?.rowsUsed, 74);
    assert.equal(agents?.report?.metrics?.overflow, 14);
    assert.equal(report.files[0]?.outcome, LintOutcome.PASS);
    assert.equal(report.partial, false);
    assert.equal(report.preset, "terminal");
    assert.equal(results[1]?.judgment?.fit.overBy, 14);
    assert.ok(failed);
  });

  test(`${label}: an exclude predicate drops matching files`, async () => {
    const { report, failed } = await lintAll(
      { "AGENTS.md": lines(20), ".claude/skills/review/SKILL.md": lines(80) },
      { exclude: (path) => path.startsWith(".claude/skills/") },
    );
    assert.deepEqual(
      report.files.map((f) => f.path),
      ["AGENTS.md"],
    );
    assert.ok(!failed);
  });

  test(`${label}: a small limit makes the report partial without failing a file`, async () => {
    const { report, failed } = await lintAll({ "AGENTS.md": lines(20), "a/b/c/CLAUDE.md": lines(20) }, { limit: 2 });
    assert.equal(report.partial, true);
    assert.ok(!failed);
  });

  test(`${label}: files come back sorted by path, and strict is recorded`, async () => {
    const noisy = ANALYSIS_TEXTS["noisy-json"];
    const { report } = await lintAll(
      { "z/AGENTS.md": lines(5), "AGENTS.md": lines(5), "m/CLAUDE.md": noisy },
      { strict: true },
    );
    assert.deepEqual(
      report.files.map((f) => f.path),
      ["AGENTS.md", "m/CLAUDE.md", "z/AGENTS.md"],
    );
    assert.equal(report.strict, true);
    assert.equal(report.files[1]?.outcome, LintOutcome.FAIL);
  });

  test(`${label}: a folder with no context files gives an empty, passing report`, async () => {
    const { report, failed } = await lintAll({ "README.md": lines(3) });
    assert.deepEqual(report.files, []);
    assert.ok(!failed);
  });
}

suite("browser", async () => browserFixture());
suite("node", nodeFixture);
