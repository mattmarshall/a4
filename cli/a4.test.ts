import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fromJsonString } from "@bufbuild/protobuf";
import { ANALYSIS_TEXTS } from "../lib/analysis/testing/texts.ts";
import { LintOutcome, LintReportSchema } from "../lib/desk/index.ts";

const CLI = fileURLToPath(new URL("./a4.ts", import.meta.url));

/** 74 lines of varied prose: Overflowing on the 60-row page. */
const overPage = Array.from(
  { length: 74 },
  (_, i) =>
    `Step ${i + 1}: confirm the ${["deploy", "cache", "schema", "tests", "budget", "alerts", "owners"][i % 7]} before item ${i * 3 + 1}.`,
).join("\n");
/** Light and clean: passes in every mode. */
const light = ANALYSIS_TEXTS.light;
/** Fits, but 37% of its ink is syntax: Noisy. */
const noisy = '{"service": "api", "owner": "team-a", "tier": 1, "deps": ["db", "cache"]}\n'.repeat(6);

interface Run {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** A temporary folder holding `files`, removed after `fn`. */
async function inFolder<T>(files: Record<string, string>, fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "a4-cli-"));
  try {
    for (const [path, content] of Object.entries(files)) {
      const target = join(dir, ...path.split("/"));
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content);
    }
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function a4(dir: string, args: readonly string[], nodeArgs: readonly string[] = []): Run {
  const run = spawnSync(process.execPath, [...nodeArgs, CLI, ...args], { cwd: dir, encoding: "utf8" });
  return { status: run.status, stdout: run.stdout, stderr: run.stderr };
}

test("a file over the page fails with its rows, verdict, and finding, and exits 1", async () => {
  await inFolder({ "AGENTS.md": overPage, "README.md": light }, async (dir) => {
    const run = a4(dir, ["lint"]);
    assert.equal(run.status, 1);
    const line = run.stdout.split("\n").find((l) => l.includes("AGENTS.md")) ?? "";
    assert.match(line, /^fail\s+74\/60\s+Overflowing\s+AGENTS\.md — 14 rows over the page$/);
    assert.ok(!run.stdout.includes("README.md"), "other Markdown isn't checked");
    assert.match(run.stdout, /1 file: 1 failed, 0 warned, 0 passed\./);
  });
});

test("files that fit exit 0", async () => {
  await inFolder({ "AGENTS.md": light, "packages/api/CLAUDE.md": light }, async (dir) => {
    const run = a4(dir, ["lint"]);
    assert.equal(run.status, 0);
    assert.match(run.stdout, /2 files: 0 failed, 0 warned, 2 passed\./);
  });
});

test("a Noisy file warns, and fails with --strict", async () => {
  await inFolder({ "CLAUDE.md": noisy }, async (dir) => {
    const plain = a4(dir, ["lint"]);
    assert.equal(plain.status, 0);
    assert.match(plain.stdout, /^warn\s+6\/60\s+Noisy\s+CLAUDE\.md/m);
    const strict = a4(dir, ["lint", "--strict"]);
    assert.equal(strict.status, 1);
    assert.match(strict.stdout, /^fail\s+6\/60\s+Noisy\s+CLAUDE\.md/m);
  });
});

test("--exclude skips matching files", async () => {
  await inFolder({ "AGENTS.md": light, ".claude/skills/review/SKILL.md": overPage }, async (dir) => {
    assert.equal(a4(dir, ["lint"]).status, 1);
    const run = a4(dir, ["lint", "--exclude", ".claude/skills/**"]);
    assert.equal(run.status, 0);
    assert.ok(!run.stdout.includes("SKILL.md"));
    assert.ok(run.stdout.includes("AGENTS.md"));
  });
});

test("a file named on the command line is checked whatever its name", async () => {
  await inFolder({ "docs/notes.md": overPage }, async (dir) => {
    const run = a4(dir, ["lint", "docs/notes.md"]);
    assert.equal(run.status, 1);
    assert.match(run.stdout, /^fail\s+74\/60\s+Overflowing\s+docs\/notes\.md/m);
  });
});

test("a folder argument prefixes its files' paths", async () => {
  await inFolder({ "packages/api/AGENTS.md": light }, async (dir) => {
    const run = a4(dir, ["lint", "packages/api/"]);
    assert.equal(run.status, 0);
    assert.match(run.stdout, /packages\/api\/AGENTS\.md/);
  });
});

test("a folder with no context files says so and exits 0", async () => {
  await inFolder({ "README.md": light }, async (dir) => {
    const run = a4(dir, ["lint"]);
    assert.equal(run.status, 0);
    assert.equal(run.stdout, "No context files found.\n");
  });
});

test("a missing path, an unknown option, or no command is a usage error (exit 2)", async () => {
  await inFolder({}, async (dir) => {
    for (const args of [["lint", "missing.md"], ["lint", "--fast"], ["lint", "--exclude"], [], ["check"]]) {
      const run = a4(dir, args);
      assert.equal(run.status, 2, args.join(" "));
      assert.match(run.stderr, /^a4: /, args.join(" "));
      assert.match(run.stderr, /Usage: a4 lint/, args.join(" "));
      assert.equal(run.stdout, "", args.join(" "));
    }
  });
});

test("--help prints the usage and exits 0", async () => {
  await inFolder({}, async (dir) => {
    for (const args of [["--help"], ["lint", "--help"], ["-h"]]) {
      const run = a4(dir, args);
      assert.equal(run.status, 0, args.join(" "));
      assert.match(run.stdout, /^Usage: a4 lint/);
    }
  });
});

test("--json prints only an a4.v1.LintReport, without any file's text", async () => {
  const secret = "token: sk-test-123";
  await inFolder({ "AGENTS.md": overPage, "CLAUDE.md": `${light}\n${secret}\n` }, async (dir) => {
    const run = a4(dir, ["lint", "--json"]);
    assert.equal(run.status, 1);
    const report = fromJsonString(LintReportSchema, run.stdout);
    assert.equal(report.preset, "terminal");
    assert.deepEqual(
      report.files.map((f) => [f.path, f.outcome]),
      [
        ["AGENTS.md", LintOutcome.FAIL],
        ["CLAUDE.md", LintOutcome.PASS],
      ],
    );
    assert.equal(report.files[0]?.report?.metrics?.rowsUsed, 74);
    assert.ok(!run.stdout.includes("sk-test-123"));
  });
});

test("linting leaves every file's bytes and modification time unchanged", async () => {
  await inFolder({ "AGENTS.md": overPage, "CLAUDE.md": noisy, "docs/x.md": light }, async (dir) => {
    const paths = ["AGENTS.md", "CLAUDE.md", "docs/x.md"].map((p) => join(dir, p));
    const before = await Promise.all(paths.map(async (p) => [await readFile(p), (await stat(p)).mtimeMs] as const));
    a4(dir, ["lint"]);
    a4(dir, ["lint", "--json", "--strict", "docs/x.md", "."]);
    const after = await Promise.all(paths.map(async (p) => [await readFile(p), (await stat(p)).mtimeMs] as const));
    assert.deepEqual(after, before);
  });
});

test("lint makes no network request", async () => {
  // A preload that makes every way out throw; the lint must not notice.
  const preload = `
    import http from "node:http";
    import https from "node:https";
    import net from "node:net";
    import tls from "node:tls";
    import { syncBuiltinESMExports } from "node:module";
    const deny = (what) => () => { throw new Error("network: " + what); };
    globalThis.fetch = deny("fetch");
    http.request = http.get = deny("http");
    https.request = https.get = deny("https");
    net.connect = net.createConnection = deny("net");
    tls.connect = deny("tls");
    syncBuiltinESMExports();
  `;
  await inFolder({ "AGENTS.md": overPage, "CLAUDE.md": light, "no-network.mjs": preload }, async (dir) => {
    const run = a4(dir, ["lint", "--json"], ["--import", join(dir, "no-network.mjs")]);
    assert.equal(run.stderr, "");
    assert.equal(run.status, 1);
    assert.equal(fromJsonString(LintReportSchema, run.stdout).files.length, 2);
  });
});
