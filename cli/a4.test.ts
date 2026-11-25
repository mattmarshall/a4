import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fromJsonString } from "@bufbuild/protobuf";
import { ANALYSIS_TEXTS } from "../lib/analysis/testing/texts.ts";
import { LetterListSchema, LetterState, sealLetter } from "../lib/desk/index.ts";
import { LintOutcome, LintReportSchema } from "../lib/desk/lint.ts";
import { nodeFolderSource } from "../lib/persist/folder/fs-node.ts";

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

function a4(dir: string, args: readonly string[], nodeArgs: readonly string[] = [], input = ""): Run {
  const run = spawnSync(process.execPath, [...nodeArgs, CLI, ...args], { cwd: dir, encoding: "utf8", input });
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

// ---------------------------------------------------------------------------
// a4 letters

const L1 = ".agents/letters/2026-11-24-1700-auth.md";
const L2 = ".agents/letters/2026-11-25-0930-auth.md";
const L3 = ".agents/letters/2026-11-25-1400-auth.md";
const LETTER_1 = "HANDOFF · auth · 2026-11-24\n\nWhere it stands. The session store moved to Redis.\n";
const LETTER_2 = "HANDOFF · auth · 2026-11-25\n\nWhere it stands. SECRET-TEXT-42 stays in the letter.\n";
const LETTER_3 = "HANDOFF · auth · 2026-11-25 (later)\n\nWhere it stands. Half done.\n";
const NOW = Date.UTC(2026, 10, 25, 9, 30);

/** Seal `path` in `dir` the way the app does. */
async function seal(dir: string, path: string, verdict: "accepted" | "returned", reason = "") {
  await sealLetter(nodeFolderSource.open(dir), path, { verdict, reason, signer: "Matt", now: NOW });
}

test("a4 letters lists each letter's state, rows, signer, and reason, oldest first", async () => {
  await inFolder({ [L1]: LETTER_1, [L2]: LETTER_2, [L3]: LETTER_3 }, async (dir) => {
    await seal(dir, L1, "accepted");
    await seal(dir, L2, "returned", "Missing the rollback plan");
    const run = a4(dir, ["letters"]);
    assert.equal(run.status, 0);
    const lines = run.stdout.trimEnd().split("\n");
    assert.equal(lines.length, 3);
    assert.match(lines[0] ?? "", /^accepted\s+\d+\/60\s+2026-11-24-1700-auth\.md\s+Matt$/);
    assert.match(lines[1] ?? "", /^returned\s+\d+\/60\s+2026-11-25-0930-auth\.md\s+Matt: Missing the rollback plan$/);
    assert.match(lines[2] ?? "", /^draft\s+\d+\/60\s+2026-11-25-1400-auth\.md$/);
  });
});

test("a4 letters --json prints an a4.v1.LetterList without letter text", async () => {
  await inFolder({ [L1]: LETTER_1, [L2]: LETTER_2 }, async (dir) => {
    await seal(dir, L1, "accepted");
    const run = a4(dir, ["letters", "--json"]);
    assert.equal(run.status, 0);
    const list = fromJsonString(LetterListSchema, run.stdout);
    assert.deepEqual(
      list.letters.map((l) => [l.path, l.state]),
      [
        [L1, LetterState.ACCEPTED],
        [L2, LetterState.DRAFT],
      ],
    );
    assert.equal(list.letters[0]?.postmark?.signer, "Matt");
    assert.ok(!run.stdout.includes("SECRET-TEXT-42"));
  });
});

test("a4 letters rejects lint's options, more than one folder, and --latest with --json", async () => {
  await inFolder({}, async (dir) => {
    for (const args of [
      ["letters", "--strict"],
      ["letters", "--exclude", "x"],
      ["letters", "a", "b"],
      ["letters", "--latest", "--json"],
      ["lint", "--latest"],
      ["letters", "missing"],
    ]) {
      const run = a4(dir, args);
      assert.equal(run.status, 2, args.join(" "));
      assert.match(run.stderr, /Usage: a4 lint/, args.join(" "));
    }
  });
});

test("a4 letters --latest prints the newest accepted letter exactly, then the letters returned since", async () => {
  await inFolder({ [L1]: LETTER_1, [L2]: LETTER_2, [L3]: LETTER_3 }, async (dir) => {
    await seal(dir, L1, "accepted");
    await seal(dir, L2, "returned", "Missing the rollback plan");
    const run = a4(dir, ["letters", "--latest"]);
    assert.equal(run.status, 0);
    assert.equal(run.stdout, `${LETTER_1}\n---\nReturned: 2026-11-25-0930-auth.md: Missing the rollback plan\n`);
  });
});

test("a4 letters --latest delivers nothing from drafts and broken seals, and exits 0", async () => {
  await inFolder({ [L1]: LETTER_1, [L2]: LETTER_2 }, async (dir) => {
    await seal(dir, L1, "accepted");
    await writeFile(join(dir, ...L1.split("/")), `${LETTER_1}Edited after sealing.\n`);
    const run = a4(dir, ["letters", "--latest"]);
    assert.equal(run.status, 0);
    assert.equal(run.stdout, "");
    assert.match(run.stderr, /no accepted letter with an intact seal/);
    assert.match(a4(dir, ["letters"]).stdout, /^broken .*\(changed after it was sealed\)$/m);
  });
});

test("a4 letters only reads, and makes no network request", async () => {
  const preload = `
    import http from "node:http";
    import https from "node:https";
    import net from "node:net";
    import { syncBuiltinESMExports } from "node:module";
    const deny = () => { throw new Error("network"); };
    globalThis.fetch = deny; http.request = http.get = deny; https.request = https.get = deny;
    net.connect = net.createConnection = deny;
    syncBuiltinESMExports();
  `;
  await inFolder({ [L1]: LETTER_1, [L2]: LETTER_2, "no-network.mjs": preload }, async (dir) => {
    await seal(dir, L1, "accepted");
    const files = [L1, L2, `${L1}.postmark.json`].map((p) => join(dir, ...p.split("/")));
    const before = await Promise.all(files.map(async (f) => [await readFile(f), (await stat(f)).mtimeMs] as const));
    const run = a4(dir, ["letters", "--latest"], ["--import", join(dir, "no-network.mjs")]);
    assert.equal(run.stderr, "");
    assert.equal(run.stdout, LETTER_1);
    a4(dir, ["letters", "--json"], ["--import", join(dir, "no-network.mjs")]);
    const after = await Promise.all(files.map(async (f) => [await readFile(f), (await stat(f)).mtimeMs] as const));
    assert.deepEqual(after, before);
  });
});

test("a4 lint checks letters: one over the page fails 3 rows over", async () => {
  const long = Array.from({ length: 63 }, (_, i) => `Step ${i + 1}: confirm item ${i * 7 + 3} first.`).join("\n");
  await inFolder({ [L2]: long }, async (dir) => {
    const run = a4(dir, ["lint"]);
    assert.equal(run.status, 1);
    assert.match(
      run.stdout,
      /^fail\s+63\/60\s+\S+\s+\.agents\/letters\/2026-11-25-0930-auth\.md — 3 rows over the page$/m,
    );
  });
});

// ---------------------------------------------------------------------------
// a4 mailroom

/** One JSON-RPC message per line, as an MCP client writes them. */
const messages = (...list: object[]) => `${list.map((m) => JSON.stringify(m)).join("\n")}\n`;

test("a4 mailroom serves MCP over stdio, writes only the new letter, and makes no network request", async () => {
  const preload = `
    import http from "node:http";
    import https from "node:https";
    import net from "node:net";
    import { syncBuiltinESMExports } from "node:module";
    const deny = () => { throw new Error("network"); };
    globalThis.fetch = deny; http.request = http.get = deny; https.request = https.get = deny;
    net.connect = net.createConnection = deny;
    syncBuiltinESMExports();
  `;
  await inFolder({ "AGENTS.md": light, [L1]: LETTER_1, [L2]: LETTER_2, "no-network.mjs": preload }, async (dir) => {
    await seal(dir, L1, "accepted");
    const files = ["AGENTS.md", L1, L2, `${L1}.postmark.json`].map((p) => join(dir, ...p.split("/")));
    const before = await Promise.all(files.map(async (f) => [await readFile(f), (await stat(f)).mtimeMs] as const));
    const input = messages(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } },
      },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "write_letter", arguments: { text: LETTER_3, topic: "auth" } },
      },
      { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "read_letter", arguments: {} } },
    );
    const run = a4(dir, ["mailroom"], ["--import", join(dir, "no-network.mjs")], input);
    assert.equal(run.stderr, "");
    assert.equal(run.status, 0, "exits 0 when input closes");
    const replies = run.stdout
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.deepEqual(
      replies.map((r) => r.id),
      [1, 2, 3, 4],
      "one line per request, in order; none for the notification",
    );
    assert.equal(replies[0].result.serverInfo.name, "a4-mailroom");
    assert.equal(replies[1].result.tools.length, 3);
    const filed = replies[2].result.structuredContent;
    assert.match(filed.path, /^\.agents\/letters\/\d{4}-\d{2}-\d{2}-\d{4}-auth\.md$/);
    assert.equal(await readFile(join(dir, ...filed.path.split("/")), "utf8"), LETTER_3);
    assert.equal(replies[3].result.content[0].text, LETTER_1, "only the accepted letter is delivered");
    const after = await Promise.all(files.map(async (f) => [await readFile(f), (await stat(f)).mtimeMs] as const));
    assert.deepEqual(after, before, "no other file changed");
    const letters = (await readdir(join(dir, ".agents", "letters"))).sort();
    assert.deepEqual(
      letters,
      [
        "2026-11-24-1700-auth.md",
        "2026-11-24-1700-auth.md.postmark.json",
        "2026-11-25-0930-auth.md",
        filed.path.slice(".agents/letters/".length),
      ].sort(),
      "the only new file is the filed letter, and no postmark was written",
    );
    assert.deepEqual((await readdir(dir)).sort(), [".agents", "AGENTS.md", "no-network.mjs"]);
  });
});

test("a4 mailroom: a missing folder, an option, or two folders is a usage error (exit 2)", async () => {
  await inFolder({}, async (dir) => {
    const missing = a4(dir, ["mailroom", "missing"]);
    assert.equal(missing.status, 2);
    assert.match(missing.stderr, /“missing” doesn’t exist/);
    assert.equal(missing.stdout, "", "nothing served");
    assert.equal(a4(dir, ["mailroom", "--json"]).status, 2);
    assert.equal(a4(dir, ["mailroom", ".", "."]).status, 2);
  });
});
