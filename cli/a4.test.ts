import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fromJsonString } from "@bufbuild/protobuf";
import { ANALYSIS_TEXTS } from "../lib/analysis/testing/texts.ts";
import { LetterListSchema, LetterState, sealLetter, StackListSchema } from "../lib/desk/index.ts";
import { LintOutcome, LintReportSchema } from "../lib/desk/lint.ts";
import { ContextXraySchema } from "../lib/desk/xray.ts";
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

// ---------------------------------------------------------------------------
// Stacks: a4 lint, a4 stacks, a4 stack

const S_AUTH = ".agents/stacks/auth";
const S_BILLING = ".agents/stacks/billing";
const CHARTER = "Charter: start an agent on the auth service.\n";
const SERVICE = "Service: sessions and refresh tokens live in Redis.\n";
const OWNERS = "Owners: Ana runs the service.\n";
const STACK_FILES: Record<string, string> = {
  [`${S_AUTH}/stack.json`]: JSON.stringify({ purpose: "Start an agent on the auth service", budgetPages: 3 }),
  [`${S_AUTH}/01-charter.md`]: CHARTER,
  [`${S_AUTH}/02-service.a5.md`]: SERVICE,
  [`${S_AUTH}/03-owners.a6.md`]: OWNERS,
  [`${S_BILLING}/stack.json`]: JSON.stringify({ purpose: "Billing", budgetPages: 2 }),
  [`${S_BILLING}/01.md`]: "Billing one.\n",
  [`${S_BILLING}/02.md`]: "Billing two.\n",
  [`${S_BILLING}/03.a5.md`]: "Billing three.\n",
};

test("a4 lint judges each stack: one over its budget fails, and stack pages are checked as pages", async () => {
  await inFolder(STACK_FILES, async (dir) => {
    const run = a4(dir, ["lint"]);
    assert.equal(run.status, 1);
    assert.match(run.stdout, /^pass\s+1\.75 of 3 pages\s+\.agents\/stacks\/auth\/$/m);
    assert.match(run.stdout, /^fail\s+2\.5 of 2 pages\s+\.agents\/stacks\/billing\/ — 0\.5 pages over its budget$/m);
    assert.match(run.stdout, /^pass\s+1\/42\s+\S+\s+\.agents\/stacks\/auth\/02-service\.a5\.md/m, "a card on 42 rows");
    assert.match(run.stdout, /2 stacks: 1 failed, 0 warned, 1 passed\./);
    const json = a4(dir, ["lint", "--json"]);
    const report = fromJsonString(LintReportSchema, json.stdout);
    assert.deepEqual(
      report.stacks.map((s) => [s.name, s.pagesUsed]),
      [
        ["auth", 1.75],
        ["billing", 2.5],
      ],
    );
  });
});

test("a4 stacks lists each stack's use and problems; --json is an a4.v1.StackList without page text", async () => {
  await inFolder(STACK_FILES, async (dir) => {
    const run = a4(dir, ["stacks"]);
    assert.equal(run.status, 0);
    assert.match(run.stdout, /^pass\s+1\.75 of 3 pages\s+auth\s+Start an agent on the auth service$/m);
    assert.match(run.stdout, /^fail\s+2\.5 of 2 pages\s+billing\s+Billing$/m);
    assert.match(run.stdout, /^\s+- 0\.5 pages over its budget$/m);
    const json = a4(dir, ["stacks", "--json"]);
    assert.equal(json.status, 0);
    const list = fromJsonString(StackListSchema, json.stdout);
    assert.deepEqual(
      list.stacks.map((s) => s.name),
      ["auth", "billing"],
    );
    assert.ok(!json.stdout.includes("refresh tokens"), "no page text");
  });
});

test("a4 stack delivers the pages in order, with the latest letter on top, and only reads", async () => {
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
  await inFolder({ ...STACK_FILES, [L1]: LETTER_1, "no-network.mjs": preload }, async (dir) => {
    await seal(dir, L1, "accepted");
    const files = Object.keys(STACK_FILES).map((p) => join(dir, ...p.split("/")));
    const before = await Promise.all(files.map(async (f) => [await readFile(f), (await stat(f)).mtimeMs] as const));
    const run = a4(dir, ["stack", "auth", "--letter"], ["--import", join(dir, "no-network.mjs")]);
    assert.equal(run.status, 0);
    assert.equal(run.stderr, "");
    assert.equal(
      run.stdout,
      `${LETTER_1}--- 01-charter.md ---\n${CHARTER}--- 02-service.a5.md ---\n${SERVICE}--- 03-owners.a6.md ---\n${OWNERS}`,
    );
    const after = await Promise.all(files.map(async (f) => [await readFile(f), (await stat(f)).mtimeMs] as const));
    assert.deepEqual(after, before);
  });
});

test("a4 stack still delivers a failing stack, with its problems on stderr; a missing stack is exit 2", async () => {
  await inFolder(STACK_FILES, async (dir) => {
    const run = a4(dir, ["stack", "billing"]);
    assert.equal(run.status, 0);
    assert.match(run.stdout, /^--- 01\.md ---$/m);
    assert.match(run.stderr, /stack billing: 0\.5 pages over its budget/);
    const missing = a4(dir, ["stack", "missing"]);
    assert.equal(missing.status, 2);
    assert.match(missing.stderr, /The stack “missing” doesn’t exist/);
    assert.equal(a4(dir, ["stack"]).status, 2, "a stack needs a name");
    assert.equal(a4(dir, ["stacks", "--letter"]).status, 2, "--letter is an option of a4 stack");
  });
});

// ---------------------------------------------------------------------------
// a4 xray

/** `n` short, different lines. */
const lines = (n: number, tag = "Line") => `${Array.from({ length: n }, (_, i) => `${tag} ${i + 1}.`).join("\n")}\n`;

/** A fixture home folder and a git repository beside it; `fn` gets their real paths. */
async function inHome<T>(
  homeFiles: Record<string, string>,
  repoFiles: Record<string, string>,
  fn: (home: string, repo: string) => Promise<T>,
): Promise<T> {
  return inFolder(
    {
      ...Object.fromEntries(Object.entries(homeFiles).map(([p, t]) => [`home/${p}`, t])),
      ...Object.fromEntries(Object.entries(repoFiles).map(([p, t]) => [`repo/${p}`, t])),
      "repo/.git/HEAD": "ref: refs/heads/main\n",
    },
    async (dir) => {
      await mkdir(join(dir, "home"), { recursive: true });
      return fn(await realpath(join(dir, "home")), await realpath(join(dir, "repo")));
    },
  );
}

function xray(home: string, repo: string, args: readonly string[] = [], nodeArgs: readonly string[] = []): Run {
  const run = spawnSync(process.execPath, [...nodeArgs, CLI, "xray", ...args], {
    cwd: repo,
    encoding: "utf8",
    env: { ...process.env, HOME: home, A4_XRAY_MANAGED: join(home, "no-managed-policy.md") },
  });
  return { status: run.status, stdout: run.stdout, stderr: run.stderr };
}

test("a4 xray lists start-up files in load order, with imports, rules, memory, and skills", async () => {
  await inHome(
    {
      ".claude/CLAUDE.md": lines(30, "User"),
      ".claude/skills/d/SKILL.md": "---\nname: d\ndescription: Personal skill d.\n---\nBody",
      ".claude/skills/e/SKILL.md": "---\nname: e\ndescription: Hidden.\ndisable-model-invocation: true\n---\nBody",
    },
    {
      "CLAUDE.md": `${lines(10, "Project")}See @docs/agents.md for conventions.\nAlso @docs/gone.md.\nLiterally \`@docs/example.md\`.\n`,
      "src/CLAUDE.md": lines(5, "Nested"),
      "docs/agents.md": lines(12, "Agents"),
      "docs/example.md": lines(3),
      ".claude/rules/api.md": '---\npaths: ["src/api/**"]\n---\nUse the API client.\n',
      ".claude/rules/style.md": "Write short functions.\n",
      ".claude/skills/a/SKILL.md": "---\nname: a\ndescription: Skill a.\n---\n",
      ".claude/skills/b/SKILL.md": "---\nname: b\ndescription: Skill b.\n---\n",
      ".claude/skills/c/SKILL.md": "---\nname: c\ndescription: Skill c.\n---\n",
    },
    async (home, repo) => {
      const project = repo.replace(/[^A-Za-z0-9]/g, "-");
      const memory = join(home, ".claude", "projects", project, "memory");
      await mkdir(memory, { recursive: true });
      await writeFile(join(memory, "MEMORY.md"), lines(260, "Memory"));
      const run = xray(home, repo);
      assert.equal(run.status, 0, run.stderr);
      const rows = run.stdout.split("\n").filter((l) => /^(user|project|import|rule|memory|skills|agents)\s/.test(l));
      assert.deepEqual(
        rows.map((l) => l.split(/\s+/)[0]),
        ["user", "project", "import", "import", "rule", "memory", "skills"],
      );
      assert.match(run.stdout, /^user\s+30\s+0\.5\s+\S+\s+~\/\.claude\/CLAUDE\.md$/m);
      assert.match(run.stdout, /^import\s+12\s+0\.2\s+\S+\s+docs\/agents\.md {2}\(imported by CLAUDE\.md\)$/m);
      assert.match(run.stdout, /^import\s+0\s+0\s+missing\s+docs\/gone\.md {2}\(imported by CLAUDE\.md\)$/m);
      assert.match(run.stdout, /^rule\s+1\s+[\d.]+\s+\S+\s+\.claude\/rules\/style\.md$/m);
      assert.match(run.stdout, /^memory\s+200\s/m, "the first 200 lines of MEMORY.md");
      assert.match(run.stdout, /^skills\s+4\s+.*4 skill descriptions$/m);
      assert.ok(!run.stdout.includes("src/CLAUDE.md"), "a nested CLAUDE.md loads only on demand");
      assert.ok(!run.stdout.includes("api.md"), "a rule with paths loads only on demand");
      assert.ok(!run.stdout.includes("example.md"), "an import in a code span isn't one");
      assert.match(run.stdout, /^Not counted: .*system prompt.*tool and MCP definitions/m);
    },
  );
});

test("a4 xray reads AGENTS.md only when no CLAUDE file is on the walk", async () => {
  await inHome({}, { "AGENTS.md": lines(10, "Agents") }, async (home, repo) => {
    assert.match(xray(home, repo).stdout, /^agents\s+10\s+.*AGENTS\.md$/m);
  });
  await inHome({}, { "AGENTS.md": lines(10, "Agents"), "CLAUDE.md": lines(5) }, async (home, repo) => {
    const run = xray(home, repo);
    assert.ok(!/^agents\s/m.test(run.stdout), "a CLAUDE.md on the walk wins");
    assert.match(run.stdout, /^project\s+5\s/m);
  });
});

test("a4 xray counts pages as rows over 60, and --budget fails over it", async () => {
  await inHome({ ".claude/CLAUDE.md": lines(30) }, { "CLAUDE.md": lines(90) }, async (home, repo) => {
    const run = xray(home, repo);
    assert.match(run.stdout, /^user\s+30\s+0\.5\s/m);
    assert.match(run.stdout, /^project\s+90\s+1\.5\s/m);
    assert.match(run.stdout, /loads 2 pages/);
  });
  await inHome({}, { "CLAUDE.md": lines(375) }, async (home, repo) => {
    const over = xray(home, repo, ["--budget", "5"]);
    assert.equal(over.status, 1);
    assert.match(over.stdout, /That's 1\.25 pages over the budget of 5\./);
    assert.equal(xray(home, repo, ["--budget", "7"]).status, 0);
    assert.equal(xray(home, repo, ["--budget", "0"]).status, 2);
    assert.equal(xray(home, repo, ["--budget", "many"]).status, 2);
  });
});

test("a4 xray --json is an a4.v1.ContextXray with no text, and the X-ray only reads", async () => {
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
  await inHome(
    { ".claude/CLAUDE.md": lines(3) },
    { "CLAUDE.md": `Repo rules.\ntoken: sk-test-123\n`, "no-network.mjs": preload },
    async (home, repo) => {
      const files = [join(home, ".claude", "CLAUDE.md"), join(repo, "CLAUDE.md")];
      const before = await Promise.all(files.map(async (f) => [await readFile(f), (await stat(f)).mtimeMs] as const));
      const run = xray(home, repo, ["--json"], ["--import", join(repo, "no-network.mjs")]);
      assert.equal(run.status, 0, run.stderr);
      const report = fromJsonString(ContextXraySchema, run.stdout);
      assert.deepEqual(
        report.sources.map((s) => s.path),
        ["~/.claude/CLAUDE.md", "CLAUDE.md"],
      );
      assert.equal(report.agent, "claude-code");
      assert.ok(!run.stdout.includes("sk-test-123"), "no file text");
      const after = await Promise.all(files.map(async (f) => [await readFile(f), (await stat(f)).mtimeMs] as const));
      assert.deepEqual(after, before);
    },
  );
});
