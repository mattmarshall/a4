/**
 * Texts that exercise every verdict and finding: the sample pages and the
 * texts of the analysis tests. The analysis copy snapshot
 * (components/analysis-copy.test.ts) renders each one on every preset.
 */

import { INCIDENT_JSON, INCIDENT_NARRATIVE, SAMPLE_PAIRS, TEMPLATES, WELCOME } from "../samples.ts";

const PROSE =
  "The team moved the billing service to a new region last spring because the old one kept " +
  "running out of capacity during month-end runs. Since then, invoices go out on time, but the " +
  "nightly export now takes twice as long, and finance has asked whether it can start earlier. " +
  "Before changing the schedule, check with the data platform group, since their warehouse load " +
  "begins right after the export finishes and would collide with an earlier start. If they agree, " +
  "move the export two hours earlier and watch the first three runs closely for timeouts. Nothing " +
  "else in the pipeline depends on the current timing, so the change should be safe to roll back.";

const WALL_WORDS = "the export moved earlier so finance gets invoices sooner each month".split(" ");

export const ANALYSIS_TEXTS: Readonly<Record<string, string>> = {
  welcome: WELCOME,
  "incident-json": INCIDENT_JSON,
  "incident-narrative": INCIDENT_NARRATIVE,
  ...Object.fromEntries(TEMPLATES.map((t) => [`template-${t.id}`, t.text])),
  ...Object.fromEntries(
    SAMPLE_PAIRS.flatMap((p) => [[`pair-${p.id}-a`, p.a] as const, [`pair-${p.id}-b`, p.b] as const]),
  ),
  empty: "",
  prose: PROSE,
  "half-page": Array.from({ length: 30 }, () => "w".repeat(40)).join("\n"),
  overflow: Array.from({ length: 67 }, (_, i) => `line ${i}`).join("\n"),
  crowded: Array.from({ length: 10 }, (_, i) => String.fromCharCode(97 + i).repeat(80)).join("\n"),
  wall: Array.from({ length: 40 }, (_, i) =>
    Array.from({ length: 12 }, (_, j) => `${WALL_WORDS[(i + j) % WALL_WORDS.length]}${i}`)
      .join(" ")
      .slice(0, 78),
  ).join("\n"),
  "json-line": '{"id": "a1", "ok": true}',
  "status-json": Array.from({ length: 10 }, (_, i) => `{"id": ${i}, "status": "ok"}`).join("\n"),
  duplicates: ["same line", "same line", "other", "same line", "same line", "}", "}"].join("\n"),
  indents: ["a", "  b", "    c", "      d", "        e"].join("\n"),
  "half-narrative": [
    "The cache was resized at peak because the policy has no minimum.",
    "Latency recovered once the cache warmed up again after the resize.",
    "We should add a minimum before the next traffic peak on Friday.",
    "owner: platform",
    "status: open",
    "priority: P1",
  ].join("\n"),
  heading: [
    "WHAT HAPPENED",
    "The cache came back cold, so almost every checkout fell through to the",
    "pricing database.",
  ].join("\n"),
  "overflowing-json": Array.from({ length: 70 }, (_, i) => `{"k${i}": [1, 2], "v": {"x": "y"}},`).join("\n"),
  "noisy-json": Array.from({ length: 12 }, (_, i) => `  {"id": "r${i}", "status": "ok", "owner": "x"},`).join("\n"),
  light: [
    "The export now runs at two in the morning, after the warehouse load.",
    "Finance asked for invoices earlier because quarter close moved up.",
    "Nothing downstream depends on the old timing, so rollback is easy.",
    "Watch the first three runs for timeouts before calling it done.",
    "Ask the data platform group if their schedule shifts again.",
  ].join("\n"),
  "repeated-term": Array.from({ length: 14 }, (_, i) => `status status r${i}`).join("\n"),
  "key-values": "name: brief\nowner: ops\nstatus: draft\n",
  "nested-json": '{"a": {"b": {"c": [1, 2, 3]}}}\n'.repeat(12),
  "status-lines": "status status status status status status status status\n".repeat(8),
  words: `${"word ".repeat(15)}\n`.repeat(30),
  "deep-indent": `${"        deep indent line\n".repeat(20)}`,
  "one-sentence": "One sentence that explains the point clearly enough.\n".repeat(3),
  "long-line": `${"A long line that keeps going past the edge of the page grid ".repeat(3)}\n`,
  "one-row-over": Array.from({ length: 61 }, (_, i) => `line ${i}`).join("\n"),
  checklist: [
    "## Release checklist",
    "- Run `pnpm check` before you tag the release.",
    "- Update **CHANGELOG.md** with the user-facing changes.",
    "- Tag it `v1.2.0` and push the tag to `origin`.",
    "- Watch the deploy at [the dashboard](https://example.com/deploy).",
    "",
  ].join("\n"),
};
