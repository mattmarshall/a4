/**
 * `a4 xray [folder] [--budget <pages>] [--json]`: the context X-ray. It lists
 * what Claude Code loads from files before its first turn in a folder, in load
 * order, and lays each source out as pages on the A4 Terminal page (README,
 * "Context X-ray"). The rules for what's read are in lib/desk/xray.ts and the
 * add-stacks design; this file walks the file system.
 *
 * Only reads, on the device, and prints paths and numbers, never a file's text.
 * `HOME` sets the home folder, and `A4_XRAY_MANAGED` the managed policy file
 * (both for tests).
 */

import { opendir, readFile, realpath, stat } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { toJsonString } from "@bufbuild/protobuf";
import { VERDICT_LABEL } from "../components/analysis-copy.ts";
import { UNREADABLE_WORDS } from "../components/desk-copy.ts";
import { MAX_FILE_BYTES } from "../lib/desk/index.ts";
import {
  type ContextXray,
  ContextXraySchema,
  importsOf,
  type IndexEntry,
  indexEntry,
  indexText,
  MAX_IMPORT_HOPS,
  memorySlice,
  ruleLoadsAtStart,
  Unreadable,
  verdictOf,
  type XrayInput,
  xrayReport,
  XraySourceKind,
} from "../lib/desk/xray.ts";
import { folderArg } from "./letters.ts";
import { slashed, UsageError } from "./usage.ts";

export interface XrayArgs {
  readonly folder: string;
  /** Pages; null for no budget. */
  readonly budget: number | null;
  readonly json: boolean;
}

/** The managed policy CLAUDE.md for this operating system. */
function managedPath(): string {
  const override = process.env.A4_XRAY_MANAGED;
  if (override !== undefined) return override;
  if (platform() === "darwin") return "/Library/Application Support/ClaudeCode/CLAUDE.md";
  if (platform() === "win32") return "C:\\Program Files\\ClaudeCode\\CLAUDE.md";
  return "/etc/claude-code/CLAUDE.md";
}

type Read = { text: string } | { unreadable: Unreadable };

const strict = new TextDecoder("utf-8", { fatal: true });

/** A file's text, why it can't be read, or null when it isn't a file. */
async function readText(path: string): Promise<Read | null> {
  const found = await stat(path).catch(() => null);
  if (!found?.isFile()) return null;
  if (found.size > MAX_FILE_BYTES) return { unreadable: Unreadable.TOO_LARGE };
  try {
    return { text: strict.decode(await readFile(path)) };
  } catch {
    return { unreadable: Unreadable.NOT_UTF8 };
  }
}

/** Every folder from the filesystem root down to `folder`, root first. */
function walkDown(folder: string): string[] {
  const chain: string[] = [];
  for (let dir = folder; ; dir = dirname(dir)) {
    chain.unshift(dir);
    if (dirname(dir) === dir) return chain;
  }
}

/** The nearest folder at or above `folder` that holds `.git`, or null. */
async function repoRoot(folder: string): Promise<string | null> {
  for (let dir = folder; ; dir = dirname(dir)) {
    if (await stat(join(dir, ".git")).catch(() => null)) return dir;
    if (dirname(dir) === dir) return null;
  }
}

/** `.md` files at any depth under `dir`, in path order. */
async function markdownUnder(dir: string): Promise<string[]> {
  const found: string[] = [];
  const visit = async (d: string) => {
    const handle = await opendir(d).catch(() => null);
    if (!handle) return;
    const entries: { name: string; dir: boolean; file: boolean }[] = [];
    for await (const e of handle) entries.push({ name: e.name, dir: e.isDirectory(), file: e.isFile() });
    entries.sort((a, b) => Number(a.name > b.name) - Number(a.name < b.name));
    for (const e of entries) {
      if (e.dir) await visit(join(d, e.name));
      else if (e.file && e.name.toLowerCase().endsWith(".md")) found.push(join(d, e.name));
    }
  };
  await visit(dir);
  return found;
}

export async function xray(args: XrayArgs): Promise<ContextXray> {
  const folder = await realpath(await folderArg(args.folder));
  const home = resolve(process.env.HOME ?? homedir());
  const shown = (path: string): string => {
    const inFolder = relative(folder, path);
    if (inFolder && !inFolder.startsWith("..") && !isAbsolute(inFolder)) return slashed(inFolder);
    const inHome = relative(home, path);
    if (inHome && !inHome.startsWith("..") && !isAbsolute(inHome)) return `~/${slashed(inHome)}`;
    return path.split(sep).join("/");
  };

  const inputs: XrayInput[] = [];
  const listed = new Set<string>();

  /** List a file and, depth-first after it, what it imports. */
  const add = async (kind: XraySourceKind, path: string, hops = 0, importedBy?: string): Promise<void> => {
    if (listed.has(path)) return;
    const read = await readText(path);
    if (read === null) {
      if (importedBy !== undefined) {
        listed.add(path);
        inputs.push({ kind, path: shown(path), importedBy, text: null, missing: true });
      }
      return;
    }
    listed.add(path);
    if ("unreadable" in read) {
      inputs.push({
        kind,
        path: shown(path),
        text: null,
        unreadable: read.unreadable,
        ...(importedBy ? { importedBy } : {}),
      });
      return;
    }
    inputs.push({ kind, path: shown(path), text: read.text, ...(importedBy ? { importedBy } : {}) });
    if (hops >= MAX_IMPORT_HOPS) return;
    for (const target of importsOf(read.text)) {
      const resolved = target.startsWith("~/") ? join(home, target.slice(2)) : resolve(dirname(path), target);
      await add(XraySourceKind.IMPORT, resolved, hops + 1, shown(path));
    }
  };

  // 1. The managed policy file, then the user's.
  await add(XraySourceKind.MANAGED, managedPath());
  await add(XraySourceKind.USER, join(home, ".claude", "CLAUDE.md"));
  // 2. The user's rules that load at start.
  const addRules = async (dir: string) => {
    for (const path of await markdownUnder(dir)) {
      const read = await readText(path);
      if (read && "text" in read && !ruleLoadsAtStart(read.text)) continue;
      await add(XraySourceKind.RULE, path);
    }
  };
  await addRules(join(home, ".claude", "rules"));
  // 3. The walk from the root down to the folder; AGENTS.md when it holds no CLAUDE file.
  const chain = walkDown(folder);
  const claudeFiles = chain.flatMap((dir) => [
    { kind: XraySourceKind.PROJECT, path: join(dir, "CLAUDE.md") },
    { kind: XraySourceKind.PROJECT, path: join(dir, ".claude", "CLAUDE.md") },
    { kind: XraySourceKind.LOCAL, path: join(dir, "CLAUDE.local.md") },
  ]);
  const present = [];
  for (const file of claudeFiles) if (await stat(file.path).catch(() => null)) present.push(file);
  if (present.length > 0) {
    for (const file of present) await add(file.kind, file.path);
  } else {
    for (const dir of chain) {
      await add(XraySourceKind.AGENTS, join(dir, "AGENTS.md"));
      await add(XraySourceKind.AGENTS, join(dir, ".claude", "AGENTS.md"));
    }
  }
  // 4. The folder's rules that load at start.
  await addRules(join(folder, ".claude", "rules"));
  // 5. Auto memory, under the repository's (or the folder's) project directory.
  const root = (await repoRoot(folder)) ?? folder;
  const project = process.env.CLAUDE_CODE_PROJECT_DIR_NAME || root.replace(/[^A-Za-z0-9]/g, "-");
  const memoryPath = join(home, ".claude", "projects", project, "memory", "MEMORY.md");
  const memory = await readText(memoryPath);
  if (memory && "text" in memory) {
    inputs.push({ kind: XraySourceKind.AUTO_MEMORY, path: shown(memoryPath), text: memorySlice(memory.text) });
  } else if (memory) {
    inputs.push({
      kind: XraySourceKind.AUTO_MEMORY,
      path: shown(memoryPath),
      text: null,
      unreadable: memory.unreadable,
    });
  }
  // 6. The skill and subagent indexes: the user's, then each folder from this one up to the repository root.
  const upToRoot: string[] = [];
  for (let dir = folder; ; dir = dirname(dir)) {
    upToRoot.push(dir);
    if (dir === root || dirname(dir) === dir) break;
  }
  const bases = [join(home, ".claude"), ...upToRoot.map((d) => join(d, ".claude"))];
  const skills: IndexEntry[] = [];
  const agents: IndexEntry[] = [];
  for (const base of [...new Set(bases)]) {
    const skillDir = await opendir(join(base, "skills")).catch(() => null);
    if (skillDir) {
      const names: string[] = [];
      for await (const e of skillDir) if (e.isDirectory()) names.push(e.name);
      for (const name of names.sort()) {
        const read = await readText(join(base, "skills", name, "SKILL.md"));
        const entry = read && "text" in read ? indexEntry(read.text, name) : null;
        if (entry) skills.push(entry);
      }
    }
    const agentDir = await opendir(join(base, "agents")).catch(() => null);
    if (agentDir) {
      const names: string[] = [];
      for await (const e of agentDir) if (e.isFile() && e.name.toLowerCase().endsWith(".md")) names.push(e.name);
      for (const name of names.sort()) {
        const read = await readText(join(base, "agents", name));
        const entry = read && "text" in read ? indexEntry(read.text, name.replace(/\.md$/i, "")) : null;
        if (entry) agents.push(entry);
      }
    }
  }
  if (skills.length > 0) {
    inputs.push({ kind: XraySourceKind.SKILLS, path: "skills", text: indexText(skills), entries: skills.length });
  }
  if (agents.length > 0) {
    inputs.push({ kind: XraySourceKind.SUBAGENTS, path: "subagents", text: indexText(agents), entries: agents.length });
  }
  return xrayReport(inputs, { folder: args.folder, ...(args.budget === null ? {} : { budget: args.budget }) });
}

const KIND: Record<XraySourceKind, string> = {
  [XraySourceKind.UNSPECIFIED]: "?",
  [XraySourceKind.MANAGED]: "managed",
  [XraySourceKind.USER]: "user",
  [XraySourceKind.PROJECT]: "project",
  [XraySourceKind.LOCAL]: "local",
  [XraySourceKind.AGENTS]: "agents",
  [XraySourceKind.RULE]: "rule",
  [XraySourceKind.IMPORT]: "import",
  [XraySourceKind.AUTO_MEMORY]: "memory",
  [XraySourceKind.SKILLS]: "skills",
  [XraySourceKind.SUBAGENTS]: "subagents",
};

/** Two decimals at most: 0.5, 1.5, 6.25. */
const pages = (n: number) => String(Math.round(n * 100) / 100);

/** The X-ray as text: a line per source, the total, the budget, and what isn't counted. */
function xrayText(report: ContextXray): string {
  const rows = report.sources.map((s) => {
    const id = verdictOf(s);
    let verdict = id ? VERDICT_LABEL[id] : "";
    if (s.missing) verdict = "missing";
    else if (s.unreadable !== Unreadable.UNSPECIFIED) verdict = UNREADABLE_WORDS[s.unreadable];
    let path = s.path;
    if (s.entries > 0) path = `${s.entries} ${s.kind === XraySourceKind.SKILLS ? "skill" : "subagent"} descriptions`;
    if (s.importedBy) path += `  (imported by ${s.importedBy})`;
    return [KIND[s.kind], String(s.rowsUsed), pages(s.pages), verdict, path];
  });
  const lines = [`Claude Code loads these files before its first turn in “${report.folder}”:`];
  if (rows.length > 0) {
    const header = ["source", "rows", "pages", "verdict", "path"];
    const all = [header, ...rows];
    const width = (i: number) => Math.max(...all.map((r) => (r[i] ?? "").length));
    for (const [kind = "", r = "", p = "", verdict = "", path = ""] of all) {
      lines.push(
        `${kind.padEnd(width(0))}  ${r.padStart(width(1))}  ${p.padStart(width(2))}  ${verdict.padEnd(width(3))}  ${path}`,
      );
    }
  } else {
    lines.push("No files.");
  }
  const files = report.sources.filter((s) => !s.missing).length;
  lines.push(
    `Before its first turn, Claude Code loads ${pages(report.totalPages)} ${report.totalPages === 1 ? "page" : "pages"} (≈${report.totalTokens.toLocaleString("en-US")} tokens) from ${files} ${files === 1 ? "source" : "sources"}.`,
  );
  if (report.budgetPages > 0) {
    lines.push(
      report.overBudget
        ? `That's ${pages(report.totalPages - report.budgetPages)} pages over the budget of ${pages(report.budgetPages)}.`
        : `That's within the budget of ${pages(report.budgetPages)} pages.`,
    );
  }
  lines.push(
    `Not counted: ${report.notCounted.join(", ")}. Files are measured as written, so HTML comments the agent strips are counted.`,
  );
  return `${lines.join("\n")}\n`;
}

/** X-ray a folder and print the report. Exits 1 over the budget, 0 otherwise. */
export async function runXray(args: XrayArgs): Promise<number> {
  if (args.budget !== null && !(args.budget > 0)) throw new UsageError("--budget takes a positive number of pages.");
  const report = await xray(args);
  process.stdout.write(
    args.json ? `${toJsonString(ContextXraySchema, report, { prettySpaces: 2 })}\n` : xrayText(report),
  );
  return report.overBudget ? 1 : 0;
}
