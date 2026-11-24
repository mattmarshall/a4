/**
 * Fail when proto/ breaks compatibility (buf's FILE rules) with a base
 * commit: PROTO_BASE when set (CI sets it to the pull request's base or the
 * previous main commit), otherwise the local main branch. When the base isn't
 * available, such as in a shallow clone that didn't fetch it, say so and skip.
 * Run through `pnpm proto:check` so `buf` is on PATH.
 */

import { execFileSync } from "node:child_process";

const base = process.env.PROTO_BASE || "main";

function resolveCommit(ref: string): string | null {
  try {
    return execFileSync("git", ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

const commit = resolveCommit(base);
if (!commit) {
  console.log(`Skipped buf breaking: ${base} isn't available in this clone. Fetch it to compare.`);
} else {
  try {
    execFileSync("buf", ["breaking", "--against", `.git#ref=${commit}`], { stdio: "inherit" });
    console.log(`proto/ is compatible with ${base} (${commit.slice(0, 7)}).`);
  } catch {
    console.error(
      `proto/ breaks compatibility with ${base}. Add fields and messages instead of changing or removing them.`,
    );
    process.exitCode = 1;
  }
}
