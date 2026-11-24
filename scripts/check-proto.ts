/**
 * Fail when the committed generated protobuf code in lib/gen differs from a
 * fresh `buf generate`. Run through `pnpm proto:check` so `buf` is on PATH.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

const COMMITTED = "lib/gen";

function files(root: string): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else out.push(relative(root, path));
    }
  };
  walk(root);
  return out.sort();
}

const scratch = mkdtempSync(join(tmpdir(), "a4-proto-"));
try {
  execFileSync("buf", ["generate", "--output", scratch], { stdio: "inherit" });
  const fresh = join(scratch, COMMITTED);
  const a = files(COMMITTED);
  const b = files(fresh);
  const problems: string[] = [];
  for (const f of new Set([...a, ...b])) {
    if (!a.includes(f)) problems.push(`missing from ${COMMITTED}: ${f}`);
    else if (!b.includes(f)) problems.push(`stale file in ${COMMITTED}: ${f}`);
    else if (!readFileSync(join(COMMITTED, f)).equals(readFileSync(join(fresh, f))))
      problems.push(`out of date: ${COMMITTED}/${f}`);
  }
  if (problems.length) {
    console.error(
      `Generated protobuf code is out of date. Run \`pnpm proto\` and commit the result.\n  ${problems.join("\n  ")}`,
    );
    process.exitCode = 1;
  } else {
    console.log(`${COMMITTED} matches proto/ (${a.length} files).`);
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
