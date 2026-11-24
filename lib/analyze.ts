/**
 * Density analysis: how a page of agent context spends its cells.
 *
 * Pure and synchronous. The one async metric (compressibility) lives in
 * `compressibility()` and is computed separately by the UI.
 */

import { capacity, tokenCeiling, type PageSpec } from "./page-spec.ts";
import { layoutRows, rowsUsed as countRowsUsed, type VisualRow } from "./text.ts";
import { estimateTokens } from "./tokens.ts";

/** Verdict and finding thresholds. The specs pin these values. */
export const THRESHOLDS = {
  noisySyntax: 0.2,
  noisyRepetition: 0.4,
  noisyDuplicateLines: 3,
  busyCrowding: 0.65,
  busyIndentation: 0.12,
  lightFill: 0.25,
  noteSyntax: 0.1,
  lowNarrative: 0.4,
  lowNarrativeMinLines: 10,
  proseMinWords: 6,
  proseMaxSyntax: 0.1,
  compressibilityMinChars: 200,
} as const;

export type LineKind = "prose" | "structured" | "heading" | "blank";

/** The page's overall reading. Labels and summaries live in the UI's copy. */
export type VerdictId = "empty" | "overflowing" | "noisy" | "busy" | "light" | "balanced";

export type Severity = "critical" | "warning" | "info";

/**
 * What the analysis found, as data: each finding's id, severity, and the
 * numbers its copy quotes. Shares are fractions (0.25 is 25%). The UI writes
 * the English (components/analysis-copy.ts).
 */
export type Finding =
  | { readonly id: "empty"; readonly severity: "info" }
  | { readonly id: "overflow"; readonly severity: "critical"; readonly rows: number }
  /** A warning when syntax is noisy; an info note when it is merely high. */
  | { readonly id: "syntax"; readonly severity: "warning" | "info"; readonly share: number }
  | {
      readonly id: "repetition";
      readonly severity: "warning";
      readonly term: string;
      readonly count: number;
      readonly share: number;
    }
  | { readonly id: "duplicates"; readonly severity: "warning"; readonly lines: number }
  | { readonly id: "crowding"; readonly severity: "warning"; readonly share: number }
  | { readonly id: "indentation"; readonly severity: "warning"; readonly share: number; readonly maxIndent: number }
  | { readonly id: "narrative"; readonly severity: "warning"; readonly share: number }
  | { readonly id: "wrapped"; readonly severity: "info"; readonly lines: number; readonly cols: number }
  | { readonly id: "room"; readonly severity: "info"; readonly tokens: number }
  | { readonly id: "clean"; readonly severity: "info" };

export type FindingId = Finding["id"];

export interface RepeatedTerm {
  term: string;
  count: number;
}

export interface Analysis {
  cols: number;
  pageRows: number;
  capacity: number;
  tokenCeiling: number;
  chars: number;
  ink: number;
  rows: VisualRow[];
  rowsTotal: number;
  rowsUsed: number;
  fill: number;
  overflow: number;
  coverage: number;
  crowding: number;
  syntaxChars: number;
  syntax: number;
  repetition: number;
  repeatedTerms: RepeatedTerm[];
  termCounts: Map<string, number>;
  duplicateLines: number;
  indentChars: number;
  indentation: number;
  maxIndent: number;
  wrappedLines: number;
  lineKinds: LineKind[];
  proseLines: number;
  structuredLines: number;
  headingLines: number;
  /** Prose / (prose + structured); null when there are neither. */
  narrative: number | null;
  tokens: number;
  charsPerToken: number | null;
  /** How each judged metric reads; the verdict, findings, and bars all use it. */
  signals: Signals;
  verdict: VerdictId;
  findings: Finding[];
}

// ---------------------------------------------------------------------------
// Character classes

const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;
const WHITESPACE = /\s/;
/** Sentence punctuation that does not count as syntax, incl. typographic forms. */
const PROSE_PUNCTUATION = new Set([".", ",", "?", "!", "'", "(", ")", "’", "‘", "“", "”", "—", "–", "…"]);

/** True when text[i] is a syntax character (scaffolding rather than words). */
export function isSyntaxAt(text: string, i: number): boolean {
  const ch = text[i];
  if (ch === undefined || WHITESPACE.test(ch) || LETTER_OR_DIGIT.test(ch)) return false;
  if (PROSE_PUNCTUATION.has(ch)) return false;
  if (ch === "-") {
    const prev = text[i - 1];
    const next = text[i + 1];
    if (prev && next && LETTER_OR_DIGIT.test(prev) && LETTER_OR_DIGIT.test(next)) return false;
  }
  return true;
}

function countSyntax(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i++) if (isSyntaxAt(text, i)) n++;
  return n;
}

function countInk(text: string): number {
  return text.match(/\S/g)?.length ?? 0;
}

// ---------------------------------------------------------------------------
// Terms and repetition

export const STOPWORDS = new Set(
  (
    "the and for are but not you all any can had her was one our out has have him his how its " +
    "may new now own see two way who did get let put say she too use that this with from they " +
    "will would there their what about which when make like than then them these some into just " +
    "only also been were being more most other such very each over after before because should " +
    "could does done where while here those your yours ours it's i'm don't can't won't isn't " +
    "aren't wasn't doesn't didn't via per yet nor both either neither until unless upon"
  ).split(" "),
);

/** Words of 3+ characters (letters, digits, underscores), starting with a letter. */
export const TERM = /\p{L}[\p{L}\p{N}_'’]*[\p{L}\p{N}_]|\p{L}[\p{L}\p{N}_]{2,}/gu;

export function normalizeTerm(raw: string): string | null {
  const term = raw.toLowerCase().replace(/’/g, "'");
  if (term.length < 3 || STOPWORDS.has(term)) return null;
  return term;
}

function termStats(text: string): { counts: Map<string, number>; repetition: number } {
  const counts = new Map<string, number>();
  for (const m of text.matchAll(TERM)) {
    const term = normalizeTerm(m[0]);
    if (term) counts.set(term, (counts.get(term) ?? 0) + 1);
  }
  let total = 0;
  let repeated = 0;
  for (const [term, count] of counts) {
    total += term.length * count;
    repeated += term.length * (count - 1);
  }
  return { counts, repetition: total === 0 ? 0 : repeated / total };
}

// ---------------------------------------------------------------------------
// Line classification

const LIST_MARKER = /^\s*(?:[-*•+]|\d+[.)])\s+/;
const KEY_VALUE = /^\s*["']?[\p{L}\p{N}_.-]+["']?\s*[:=]\s*(?:\S|$)/u;
const WORD = /\p{L}[\p{L}\p{N}'’-]*/gu;

function wordCount(s: string): number {
  return s.match(WORD)?.length ?? 0;
}

function isHeading(line: string): boolean {
  const t = line.trim();
  if (/^#{1,6}\s/.test(t)) return true;
  const letters = t.match(/\p{L}/gu) ?? [];
  if (letters.length >= 2 && t.length <= 80 && t === t.toUpperCase() && /\p{Lu}/u.test(t)) {
    return wordCount(t) <= 10;
  }
  return false;
}

export function classifyLines(lines: string[]): LineKind[] {
  const kinds: LineKind[] = [];
  let previous: LineKind = "blank";
  for (const line of lines) {
    let kind: LineKind;
    if (line.trim() === "") {
      kind = "blank";
    } else if (isHeading(line)) {
      kind = "heading";
    } else {
      const body = line.replace(LIST_MARKER, "");
      const ink = countInk(body);
      const syntaxShare = ink === 0 ? 1 : countSyntax(body) / ink;
      const firstChar = body.trimStart()[0] ?? "";
      const opensStructure = "{[<|".includes(firstChar);
      const words = wordCount(body);
      const clean = syntaxShare <= THRESHOLDS.proseMaxSyntax && !opensStructure;
      if (clean && words >= THRESHOLDS.proseMinWords) {
        kind = "prose";
      } else if (clean && words >= 1 && previous === "prose" && !LIST_MARKER.test(line) && !KEY_VALUE.test(line)) {
        // Short tail of a wrapped paragraph.
        kind = "prose";
      } else {
        kind = "structured";
      }
    }
    kinds.push(kind);
    previous = kind;
  }
  return kinds;
}

// ---------------------------------------------------------------------------
// Analysis

export function analyze(text: string, spec: PageSpec): Analysis {
  const cols = spec.cols;
  const pageRows = spec.rows;
  const cap = capacity(spec);
  const rows = layoutRows(text, cols);
  const used = countRowsUsed(rows);
  const lines = text.split("\n");

  const ink = countInk(text);
  const syntaxChars = countSyntax(text);
  const { counts: termCounts, repetition } = termStats(text);
  const repeatedTerms = [...termCounts.entries()]
    .filter(([, c]) => c > 1)
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length || a[0].localeCompare(b[0]))
    .map(([term, count]) => ({ term, count }));

  const seen = new Map<string, number>();
  let duplicateLines = 0;
  let indentChars = 0;
  let maxIndent = 0;
  let wrappedLines = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (line.length > cols) wrappedLines++;
    if (trimmed === "") continue;
    const indent = line.length - line.trimStart().length;
    indentChars += indent;
    maxIndent = Math.max(maxIndent, indent);
    if (LETTER_OR_DIGIT.test(trimmed)) {
      const n = (seen.get(trimmed) ?? 0) + 1;
      seen.set(trimmed, n);
      if (n > 1) duplicateLines++;
    }
  }

  const lineKinds = classifyLines(lines);
  const proseLines = lineKinds.filter((k) => k === "prose").length;
  const structuredLines = lineKinds.filter((k) => k === "structured").length;
  const headingLines = lineKinds.filter((k) => k === "heading").length;
  const narrativeBase = proseLines + structuredLines;

  const usedCells = used * cols;
  const tokens = estimateTokens(text);
  const fill = used / pageRows;
  const overflow = Math.max(0, used - pageRows);

  const partial: Omit<Analysis, "signals" | "verdict" | "findings"> = {
    cols,
    pageRows,
    capacity: cap,
    tokenCeiling: tokenCeiling(spec),
    chars: text.length,
    ink,
    rows,
    rowsTotal: rows.length,
    rowsUsed: used,
    fill,
    overflow,
    coverage: ink / cap,
    crowding: usedCells === 0 ? 0 : ink / usedCells,
    syntaxChars,
    syntax: ink === 0 ? 0 : syntaxChars / ink,
    repetition,
    repeatedTerms,
    termCounts,
    duplicateLines,
    indentChars,
    indentation: usedCells === 0 ? 0 : indentChars / usedCells,
    maxIndent,
    wrappedLines,
    lineKinds,
    proseLines,
    structuredLines,
    headingLines,
    narrative: narrativeBase === 0 ? null : proseLines / narrativeBase,
    tokens,
    charsPerToken: tokens === 0 ? null : text.length / tokens,
  };

  const judged = signals(partial);
  const verdict = verdictFor(partial, judged);
  return { ...partial, signals: judged, verdict, findings: findingsFor(partial, verdict, judged) };
}

type Metrics = Omit<Analysis, "signals" | "verdict" | "findings">;

/**
 * How a metric reads: fine ("ok"), worth a note ("warn"), a problem ("bad"),
 * or not applicable ("na": no value, or too little text to judge).
 */
export type Tone = "ok" | "warn" | "bad" | "na";

/** One tone per judged metric, computed once; verdict, findings, and bars all read it. */
export interface Signals {
  syntax: Tone;
  repetition: Tone;
  duplicates: Tone;
  narrative: Tone;
  crowding: Tone;
  indentation: Tone;
}

export function signals(m: Metrics): Signals {
  const t = THRESHOLDS;
  const narrativeBase = m.proseLines + m.structuredLines;
  return {
    syntax: m.syntax >= t.noisySyntax ? "bad" : m.syntax >= t.noteSyntax ? "warn" : "ok",
    repetition: m.repetition >= t.noisyRepetition && m.repeatedTerms.length > 0 ? "bad" : "ok",
    duplicates: m.duplicateLines >= t.noisyDuplicateLines ? "bad" : "ok",
    narrative:
      m.narrative === null || narrativeBase < t.lowNarrativeMinLines
        ? "na"
        : m.narrative < t.lowNarrative
          ? "bad"
          : "ok",
    crowding: m.crowding >= t.busyCrowding ? "bad" : "ok",
    indentation: m.indentation >= t.busyIndentation ? "bad" : "ok",
  };
}

export function verdictFor(m: Metrics, s: Signals = signals(m)): VerdictId {
  const t = THRESHOLDS;
  if (m.ink === 0) return "empty";
  if (m.overflow > 0) return "overflowing";
  if (s.syntax === "bad" || s.repetition === "bad" || s.duplicates === "bad") return "noisy";
  // A short page is Light even when its few rows are dense; crowding only
  // makes a page Busy once there is enough of it to be hard to scan.
  if (m.fill < t.lightFill) return "light";
  if (s.crowding === "bad" || s.indentation === "bad") return "busy";
  return "balanced";
}

export function findingsFor(m: Metrics, verdict: VerdictId, s: Signals = signals(m)): Finding[] {
  const t = THRESHOLDS;
  const out: Finding[] = [];

  if (verdict === "empty") return [{ id: "empty", severity: "info" }];

  if (m.overflow > 0) out.push({ id: "overflow", severity: "critical", rows: m.overflow });

  if (s.syntax === "bad") out.push({ id: "syntax", severity: "warning", share: m.syntax });
  else if (s.syntax === "warn") out.push({ id: "syntax", severity: "info", share: m.syntax });

  const top = m.repeatedTerms[0];
  if (s.repetition === "bad" && top) {
    out.push({ id: "repetition", severity: "warning", term: top.term, count: top.count, share: m.repetition });
  }

  if (s.duplicates === "bad") out.push({ id: "duplicates", severity: "warning", lines: m.duplicateLines });

  if (s.crowding === "bad") out.push({ id: "crowding", severity: "warning", share: m.crowding });

  if (s.indentation === "bad") {
    out.push({ id: "indentation", severity: "warning", share: m.indentation, maxIndent: m.maxIndent });
  }

  if (s.narrative === "bad" && m.narrative !== null) {
    out.push({ id: "narrative", severity: "warning", share: m.narrative });
  }

  if (m.wrappedLines > 0) out.push({ id: "wrapped", severity: "info", lines: m.wrappedLines, cols: m.cols });

  if (m.overflow === 0 && m.fill < t.lightFill) {
    out.push({ id: "room", severity: "info", tokens: Math.max(0, m.tokenCeiling - m.tokens) });
  }

  // "Reads clean" only when no signal needs attention (a syntax note does).
  const quiet = Object.values(s).every((tone) => tone === "ok" || tone === "na");
  if (quiet && out.every((f) => f.severity === "info") && (verdict === "balanced" || verdict === "light")) {
    out.unshift({ id: "clean", severity: "info" });
  }

  return out;
}

// ---------------------------------------------------------------------------
// Compressibility (async, browser or Node 18+)

/** Deflate-compressed size divided by UTF-8 size; null below the minimum length. */
export async function compressibility(text: string): Promise<number | null> {
  if (text.length < THRESHOLDS.compressibilityMinChars) return null;
  if (typeof CompressionStream === "undefined") return null;
  const bytes = new TextEncoder().encode(text);
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  const compressed = await new Response(stream).arrayBuffer();
  return compressed.byteLength / bytes.byteLength;
}
