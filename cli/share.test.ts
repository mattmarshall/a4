import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sealLetter } from "../lib/desk/index.ts";
import { nodeFolderSource } from "../lib/persist/folder/fs-node.ts";
import { readLink, SHARE_ORIGIN, shareLink } from "../lib/share/index.ts";
import { safeFileName } from "./share.ts";

const CLI = fileURLToPath(new URL("./a4.ts", import.meta.url));
const LETTER = ".agents/letters/2026-11-25-0930-auth.md";

function a4(dir: string, args: readonly string[]) {
  const run = spawnSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: "utf8" });
  return { status: run.status, stdout: run.stdout, stderr: run.stderr };
}

async function inFolder<T>(files: Record<string, string>, fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "a4-share-"));
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

test("sharing an accepted letter prints one link that carries its intact seal", async () => {
  await inFolder({ [LETTER]: "# Auth\nShip the token refresh on Friday.\n" }, async (dir) => {
    await sealLetter(nodeFolderSource.open(dir), LETTER, {
      verdict: "accepted",
      reason: "",
      signer: "Matt",
      now: Date.parse("2026-11-25T10:00:00Z"),
    });
    const run = a4(dir, ["share", LETTER]);
    assert.equal(run.status, 0, run.stderr);
    const lines = run.stdout.trim().split("\n");
    assert.equal(lines.length, 1);
    assert.match(lines[0] ?? "", /^https:\/\/a4\.marsh\.build\/#s1\.[A-Za-z0-9_-]+$/);
    const [page] = await readLink(lines[0] ?? "");
    assert.equal(page?.name, "2026-11-25-0930-auth.md");
    assert.equal(page?.postmark?.signer, "Matt");

    const out = a4(dir, ["open", lines[0] ?? "", "--out", "."]);
    assert.equal(out.status, 0, out.stderr);
    assert.match(out.stdout, /Accepted by Matt on 2026-11-25\. Seal intact\./);
    assert.match(out.stdout, /doesn’t prove who sealed it/);
    const written = await readdir(dir);
    assert.ok(written.includes("2026-11-25-0930-auth.md"));
    assert.equal(
      written.some((f) => f.endsWith(".postmark.json")),
      false,
      "no postmark is written",
    );
  });
});

test("a pair shares as one link, A then B", async () => {
  await inFolder({ "Brief.md": "short", "Brief (fit).md": "shorter" }, async (dir) => {
    const run = a4(dir, ["share", "Brief.md", "Brief (fit).md"]);
    assert.equal(run.status, 0, run.stderr);
    const pages = await readLink(run.stdout.trim());
    assert.deepEqual(
      pages.map((p) => p.name),
      ["Brief.md", "Brief (fit).md"],
    );
  });
});

test("a page too large for a link exits 1; a missing file or a third file exits 2", async () => {
  await inFolder({ "Noise.md": randomBytes(30_000).toString("base64") }, async (dir) => {
    const big = a4(dir, ["share", "Noise.md"]);
    assert.equal(big.status, 1);
    assert.match(big.stderr, /too large for a link/);
    assert.equal(big.stdout, "");
    assert.equal(a4(dir, ["share", "Missing.md"]).status, 2);
    assert.equal(a4(dir, ["share", "a.md", "b.md", "c.md"]).status, 2);
    assert.equal(a4(dir, ["open"]).status, 2);
  });
});

test("opening never overwrites: a pair with one name taken writes neither page, and exits 2", async () => {
  await inFolder({ "Charter.md": "mine" }, async (dir) => {
    const link = await shareLink(
      [
        { name: "Notes", preset: "terminal", paper: "a4", bytes: new TextEncoder().encode("theirs") },
        { name: "Charter", preset: "terminal", paper: "a4", bytes: new TextEncoder().encode("theirs too") },
      ],
      SHARE_ORIGIN,
    );
    const run = a4(dir, ["open", link]);
    assert.equal(run.status, 2);
    assert.match(run.stderr, /“Charter\.md” already exists/);
    assert.equal(await readFile(join(dir, "Charter.md"), "utf8"), "mine");
    assert.deepEqual((await readdir(dir)).sort(), ["Charter.md"], "Notes.md wasn't written either");
  });
});

test("a link that can't be read exits 1", async () => {
  await inFolder({}, async (dir) => {
    const run = a4(dir, ["open", "https://a4.marsh.build/#s1.@@@"]);
    assert.equal(run.status, 1);
    assert.match(run.stderr, /damaged/);
    assert.equal(a4(dir, ["open", "https://a4.marsh.build/#s2.abc"]).status, 1);
  });
});

test("a name that climbs out of the folder is written as a safe name inside it", async () => {
  await inFolder({}, async (dir) => {
    const link = await shareLink(
      [{ name: "../../etc/x", preset: "terminal", paper: "a4", bytes: new TextEncoder().encode("x") }],
      SHARE_ORIGIN,
    );
    await mkdir(join(dir, "out"));
    const run = a4(dir, ["open", link, "--out", "out"]);
    assert.equal(run.status, 0, run.stderr);
    assert.deepEqual(await readdir(join(dir, "out")), ["etc-x.md"]);
  });
});

test("safe file names", () => {
  assert.equal(safeFileName("Charter"), "Charter.md");
  assert.equal(safeFileName("CLAUDE.md"), "CLAUDE.md");
  assert.equal(safeFileName("rules.mdc"), "rules.mdc");
  assert.equal(safeFileName(".env"), "env.md");
  assert.equal(safeFileName("a/b\\c"), "a-b-c.md");
  assert.equal(safeFileName("   "), "shared-page.md");
  // A name longer than any file system allows is cut to a page name's 80 characters, so a pair is never half-written.
  assert.equal(safeFileName(`${"x".repeat(300)}.md`), `${"x".repeat(80)}.md`);
});
