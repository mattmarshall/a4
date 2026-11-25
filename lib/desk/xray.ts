/**
 * The context X-ray's rules: reading what a coding agent loads from files
 * before its first turn, and laying it out as pages. These are the pure parts
 * (imports, rule front matter, skill descriptions, the auto-memory slice, and
 * the report); cli/xray.ts walks the file system and hands the texts here.
 *
 * The loading rules follow Claude Code's documentation (code.claude.com docs,
 * "memory", "skills", "sub-agents", as checked on 2026-11-25); see the
 * add-stacks design for where the docs are silent. Runtime-agnostic, and not
 * re-exported from the desk index: only the a4 command uses it.
 */

import { create } from "@bufbuild/protobuf";
import type { VerdictId } from "../analysis/index.ts";
import { Verdict } from "../gen/a4/v1/analysis_pb.js";
import { Unreadable } from "../gen/a4/v1/lint_pb.js";
import {
  type ContextXray,
  ContextXraySchema,
  type XraySource,
  type XraySourceKind,
  XraySourceSchema,
} from "../gen/a4/v1/xray_pb.js";
import { judgeFile } from "./judge.ts";

export type { ContextXray, XraySource } from "../gen/a4/v1/xray_pb.js";
export { ContextXraySchema, XraySourceKind } from "../gen/a4/v1/xray_pb.js";
export { Unreadable } from "../gen/a4/v1/lint_pb.js";

/** How deep imports go: an imported file may import others, up to four hops. */
export const MAX_IMPORT_HOPS = 4;

/** A description and its `when_to_use` are cut here in the skill listing. */
export const DESCRIPTION_LIMIT = 1536;

/** Auto memory's MEMORY.md loads at most this many lines… */
export const MEMORY_LINES = 200;
/** …and at most this many bytes (25 KB). */
export const MEMORY_BYTES = 25 * 1024;

/** Rows on the A4 Terminal page: a source's pages are its rows over these. */
const PAGE_ROWS = 60;

/** What the X-ray can't count, because it isn't a file it can read. */
export const NOT_COUNTED: readonly string[] = [
  "the agent's system prompt",
  "tool and MCP definitions",
  "plugin skills and subagents",
  "output styles",
  "session-start hook output",
];

/**
 * The `@path` imports in a memory file, in order: an `@` at the start of a
 * line or after whitespace, outside code spans and fenced code blocks. `\ `
 * keeps a space in a path, and trailing punctuation (`.,;:!?)`) is dropped.
 */
export function importsOf(text: string): string[] {
  const imports: string[] = [];
  let fence: string | null = null;
  for (const line of text.split(/\r\n|\r|\n/)) {
    const marker = /^\s*(```+|~~~+)/.exec(line)?.[1];
    if (marker) {
      if (fence === null) fence = marker[0] ?? null;
      else if (marker.startsWith(fence)) fence = null;
      continue;
    }
    if (fence !== null) continue;
    // Drop code spans before looking for imports.
    const prose = line.replace(/(`+)[\s\S]*?\1/g, " ");
    const found = /(^|\s)@((?:\\ |[^\s])+)/g;
    for (let m = found.exec(prose); m; m = found.exec(prose)) {
      const path = (m[2] ?? "").replace(/[.,;:!?)]+$/, "").replace(/\\ /g, " ");
      if (path.length > 0 && path !== "~") imports.push(path);
    }
  }
  return imports;
}

/**
 * A file's YAML front matter as top-level keys and their text, or null when
 * it has none or it can't be read. Enough for rules and skills: `key: value`
 * lines, quoted values, `|` and `>` block scalars, and lists under a key.
 */
export function frontMatter(text: string): Map<string, string> | null {
  const lines = text.split(/\r\n|\r|\n/);
  if (lines[0]?.trim() !== "---") return null;
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
  if (end < 0) return null;
  const fields = new Map<string, string>();
  let key: string | null = null;
  let block: string[] = [];
  let folded = false;
  const close = () => {
    if (key !== null && block.length > 0) fields.set(key, block.join(folded ? " " : "\n").trim());
    block = [];
  };
  for (const line of lines.slice(1, end)) {
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    const field = /^([A-Za-z_][\w-]*):(?:\s+(.*))?$/.exec(line);
    if (field && !/^\s/.test(line)) {
      close();
      key = field[1] ?? null;
      const value = (field[2] ?? "").trim();
      folded = value.startsWith(">");
      if (value === "" || value === "|" || value === ">" || /^[|>][+-]?$/.test(value)) {
        if (key !== null) fields.set(key, "");
      } else if (key !== null) {
        fields.set(key, value.replace(/^(["'])(.*)\1$/, "$2"));
      }
      continue;
    }
    // A continuation: an indented line or a list item belongs to the last key.
    if (key === null || !/^\s|^-/.test(line)) return null;
    block.push(line.trim().replace(/^-\s*/, ""));
  }
  close();
  return fields;
}

/** A rule loads at start unless its front matter names `paths`; front matter that can't be read counts as none. */
export function ruleLoadsAtStart(text: string): boolean {
  const fields = frontMatter(text);
  return !(fields?.has("paths") ?? false);
}

/** A skill's or subagent's entry in the listing the agent sees at start. */
export interface IndexEntry {
  readonly name: string;
  readonly description: string;
}

/**
 * A skill's or subagent's listing entry from its file, or null when it
 * isn't listed (a skill with `disable-model-invocation: true`). The name
 * falls back to `fallbackName` (the skill's folder or the agent's file).
 */
export function indexEntry(text: string, fallbackName: string): IndexEntry | null {
  const fields = frontMatter(text) ?? new Map<string, string>();
  if (fields.get("disable-model-invocation") === "true") return null;
  const name = fields.get("name") || fallbackName;
  const description = [fields.get("description"), fields.get("when_to_use")].filter(Boolean).join(" ");
  return { name, description: description.slice(0, DESCRIPTION_LIMIT) };
}

/** An index's text: one `name: description` line per entry. */
export function indexText(entries: readonly IndexEntry[]): string {
  return entries.map((e) => (e.description ? `${e.name}: ${e.description}` : e.name)).join("\n");
}

/** What loads of auto memory's MEMORY.md: the first 200 lines, at most 25 KB, cut on a character. */
export function memorySlice(text: string): string {
  const lines = text.split("\n").slice(0, MEMORY_LINES).join("\n");
  const bytes = new TextEncoder().encode(lines);
  if (bytes.length <= MEMORY_BYTES) return lines;
  // Back off to a character boundary (a UTF-8 continuation byte is 10xxxxxx).
  let cut = MEMORY_BYTES;
  while (cut > 0 && ((bytes[cut] ?? 0) & 0xc0) === 0x80) cut--;
  return new TextDecoder().decode(bytes.subarray(0, cut));
}

/** One source as the walk found it: its text, or why there is none. */
export interface XrayInput {
  readonly kind: XraySourceKind;
  /** As shown: `~/…`, folder-relative, or absolute. */
  readonly path: string;
  readonly importedBy?: string;
  /** The text the agent loads (already sliced for auto memory); null when it can't be read or is missing. */
  readonly text: string | null;
  readonly unreadable?: Unreadable;
  readonly missing?: boolean;
  /** For an index: how many entries it lists. */
  readonly entries?: number;
}

const VERDICT_ID: Readonly<Record<Verdict, VerdictId | null>> = {
  [Verdict.UNSPECIFIED]: null,
  [Verdict.EMPTY]: "empty",
  [Verdict.OVERFLOWING]: "overflowing",
  [Verdict.NOISY]: "noisy",
  [Verdict.LIGHT]: "light",
  [Verdict.BUSY]: "busy",
  [Verdict.BALANCED]: "balanced",
};

/** A source's verdict, or null when it couldn't be read. */
export function verdictOf(source: XraySource): VerdictId | null {
  return source.report ? VERDICT_ID[source.report.verdict] : null;
}

/** One source judged on the A4 Terminal page. */
export function xraySource(input: XrayInput): XraySource {
  const base = {
    kind: input.kind,
    path: input.path,
    importedBy: input.importedBy ?? "",
    unreadable: input.unreadable ?? Unreadable.UNSPECIFIED,
    missing: input.missing ?? false,
    entries: input.entries ?? 0,
  };
  if (input.text === null) return create(XraySourceSchema, base);
  const judgment = judgeFile(input.text, "a4");
  return create(XraySourceSchema, {
    ...base,
    rowsUsed: judgment.fit.rowsUsed,
    pages: judgment.fit.rowsUsed / PAGE_ROWS,
    tokens: judgment.analysis.metrics.tokens,
    report: judgment.report,
  });
}

/** The X-ray: every source in load order, the totals, the budget, and what isn't counted. */
export function xrayReport(inputs: readonly XrayInput[], options: { folder: string; budget?: number }): ContextXray {
  const sources = inputs.map(xraySource);
  const totalRows = sources.reduce((sum, s) => sum + s.rowsUsed, 0);
  const totalPages = totalRows / PAGE_ROWS;
  const budget = options.budget ?? 0;
  return create(ContextXraySchema, {
    agent: "claude-code",
    folder: options.folder,
    sources,
    totalPages,
    totalTokens: sources.reduce((sum, s) => sum + s.tokens, 0),
    budgetPages: budget,
    overBudget: budget > 0 && totalPages > budget,
    notCounted: [...NOT_COUNTED],
  });
}
