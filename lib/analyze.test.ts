import { test } from "node:test";
import assert from "node:assert/strict";
import { analyze, compressibility, isSyntaxAt, THRESHOLDS } from "./analyze.ts";
import { PRESETS } from "./page-spec.ts";
import { estimateTokens } from "./tokens.ts";
import { INCIDENT_JSON, INCIDENT_NARRATIVE, TEMPLATES, WELCOME } from "./samples.ts";

const T = PRESETS.terminal;

const PROSE =
  "The team moved the billing service to a new region last spring because the old one kept " +
  "running out of capacity during month-end runs. Since then, invoices go out on time, but the " +
  "nightly export now takes twice as long, and finance has asked whether it can start earlier. " +
  "Before changing the schedule, check with the data platform group, since their warehouse load " +
  "begins right after the export finishes and would collide with an earlier start. If they agree, " +
  "move the export two hours earlier and watch the first three runs closely for timeouts. Nothing " +
  "else in the pipeline depends on the current timing, so the change should be safe to roll back.";

test("empty page", () => {
  const a = analyze("", T);
  assert.equal(a.verdict, "empty");
  assert.equal(a.ink, 0);
  assert.equal(a.rowsUsed, 0);
  assert.equal(a.findings[0].id, "empty");
});

test("fill: 30 lines of 40 characters is half a page with no overflow", () => {
  const text = Array.from({ length: 30 }, () => "w".repeat(40)).join("\n");
  const a = analyze(text, T);
  assert.equal(a.rowsUsed, 30);
  assert.equal(a.fill, 0.5);
  assert.equal(a.overflow, 0);
});

test("overflow counts rows past the page and produces a critical finding", () => {
  const text = Array.from({ length: 67 }, (_, i) => `line ${i}`).join("\n");
  const a = analyze(text, T);
  assert.equal(a.overflow, 7);
  assert.equal(a.verdict, "overflowing");
  const f = a.findings.find((x) => x.id === "overflow");
  assert.ok(f);
  assert.equal(f.severity, "critical");
  assert.equal(f.rows, 7);
});

test("coverage and crowding", () => {
  const text = Array.from({ length: 10 }, (_, i) => String.fromCharCode(97 + i).repeat(80)).join("\n");
  const a = analyze(text, T);
  assert.ok(Math.abs(a.coverage - 800 / 4800) < 1e-9);
  assert.equal(a.crowding, 1);
  assert.equal(a.verdict, "light");
  assert.ok(a.findings.some((f) => f.id === "crowding"));
});

test("a 40-row wall of text is Busy", () => {
  const words = "the export moved earlier so finance gets invoices sooner each month".split(" ");
  const text = Array.from({ length: 40 }, (_, i) =>
    Array.from({ length: 12 }, (_, j) => `${words[(i + j) % words.length]}${i}`)
      .join(" ")
      .slice(0, 78),
  ).join("\n");
  const a = analyze(text, T);
  assert.ok(a.crowding >= THRESHOLDS.busyCrowding, `crowding ${a.crowding}`);
  assert.equal(a.verdict, "busy");
});

test("syntax overhead: JSON is heavy, prose is light", () => {
  assert.ok(analyze('{"id": "a1", "ok": true}', T).syntax > 0.3);
  assert.ok(analyze(PROSE, T).syntax < 0.05);
});

test("syntax exceptions: sentence punctuation and intra-word hyphens", () => {
  const s = "well-known (yes), it's fine. 2026-11-20 — done… “ok”";
  for (let i = 0; i < s.length; i++) {
    assert.equal(isSyntaxAt(s, i), false, `index ${i} (${s[i]})`);
  }
  assert.equal(isSyntaxAt("a: b", 1), true);
  assert.equal(isSyntaxAt("- item", 0), true);
});

test("repetition lists repeated terms with counts", () => {
  const text = Array.from({ length: 10 }, (_, i) => `{"id": ${i}, "status": "ok"}`).join("\n");
  const a = analyze(text, T);
  const status = a.repeatedTerms.find((t) => t.term === "status");
  assert.ok(status);
  assert.equal(status.count, 10);
});

test("duplicate lines count repeats beyond the first occurrence", () => {
  const a = analyze(["same line", "same line", "other", "same line", "same line", "}", "}"].join("\n"), T);
  assert.equal(a.duplicateLines, 3);
});

test("indentation reports the deepest indent", () => {
  const a = analyze(["a", "  b", "    c", "      d", "        e"].join("\n"), T);
  assert.equal(a.maxIndent, 8);
  assert.ok(a.indentation > 0);
});

test("narrative share: three sentences and three fields is 50%", () => {
  const text = [
    "The cache was resized at peak because the policy has no minimum.",
    "Latency recovered once the cache warmed up again after the resize.",
    "We should add a minimum before the next traffic peak on Friday.",
    "owner: platform",
    "status: open",
    "priority: P1",
  ].join("\n");
  const a = analyze(text, T);
  assert.equal(a.proseLines, 3);
  assert.equal(a.structuredLines, 3);
  assert.equal(a.narrative, 0.5);
});

test("short tail of a wrapped paragraph counts as prose; headings are separate", () => {
  const text = [
    "WHAT HAPPENED",
    "The cache came back cold, so almost every checkout fell through to the",
    "pricing database.",
  ].join("\n");
  const a = analyze(text, T);
  assert.deepEqual(a.lineKinds, ["heading", "prose", "prose"]);
  assert.equal(a.narrative, 1);
});

test("token estimate for prose lands between 0.18 and 0.32 tokens per character", () => {
  const text = PROSE.repeat(2).slice(0, 1000);
  const tokens = estimateTokens(text);
  assert.ok(tokens >= 180 && tokens <= 320, `estimated ${tokens}`);
  const a = analyze(text, T);
  assert.equal(a.tokens, tokens);
  assert.ok(a.charsPerToken !== null && a.charsPerToken > 3);
});

test("verdict order: overflow wins over noise", () => {
  const text = Array.from({ length: 70 }, (_, i) => `{"k${i}": [1, 2], "v": {"x": "y"}},`).join("\n");
  assert.equal(analyze(text, T).verdict, "overflowing");
});

test("verdict: noisy, light, balanced", () => {
  const json = Array.from({ length: 12 }, (_, i) => `  {"id": "r${i}", "status": "ok", "owner": "x"},`).join("\n");
  assert.equal(analyze(json, T).verdict, "noisy");
  const varied = [
    "The export now runs at two in the morning, after the warehouse load.",
    "Finance asked for invoices earlier because quarter close moved up.",
    "Nothing downstream depends on the old timing, so rollback is easy.",
    "Watch the first three runs for timeouts before calling it done.",
    "Ask the data platform group if their schedule shifts again.",
  ].join("\n");
  assert.equal(analyze(varied, T).verdict, "light");
  assert.equal(analyze(INCIDENT_NARRATIVE, T).verdict, "balanced");
});

test("repeated-term finding names the top term and its count", () => {
  const text = Array.from({ length: 14 }, (_, i) => `status status r${i}`).join("\n");
  const a = analyze(text, T);
  assert.ok(a.repetition >= THRESHOLDS.noisyRepetition);
  const f = a.findings.find((x) => x.id === "repetition");
  assert.ok(f);
  assert.equal(f.severity, "warning");
  assert.equal(f.term, "status");
  assert.equal(f.count, 28);
});

test("compressibility: repetitive text compresses below 10%", async () => {
  const text = `${"The same forty-character line, repeated."}\n`.repeat(50);
  const c = await compressibility(text);
  assert.ok(c !== null && c < 0.1, `got ${c}`);
  assert.equal(await compressibility("short"), null);
});

test("a short key-value page: narrative is not applicable, and no narrative finding", () => {
  const a = analyze("name: brief\nowner: ops\nstatus: draft\n", PRESETS.terminal);
  assert.equal(a.signals.narrative, "na");
  assert.ok(!a.findings.some((f) => f.id === "narrative"));
});

test("every warn or bad signal has its finding, and Reads clean never sits beside one", () => {
  const texts = [
    ...[WELCOME, INCIDENT_JSON, INCIDENT_NARRATIVE, ...TEMPLATES.map((t) => t.text)],
    "name: brief\nowner: ops\nstatus: draft\n",
    '{"a": {"b": {"c": [1, 2, 3]}}}\n'.repeat(12),
    "status status status status status status status status\n".repeat(8),
    `${"word ".repeat(15)}\n`.repeat(30),
    `${"        deep indent line\n".repeat(20)}`,
    "One sentence that explains the point clearly enough.\n".repeat(3),
  ];
  for (const preset of Object.values(PRESETS)) {
    for (const text of texts) {
      const a = analyze(text, preset);
      for (const [metric, tone] of Object.entries(a.signals)) {
        if (tone === "warn" || tone === "bad") {
          assert.ok(
            a.findings.some((f) => f.id === metric),
            `${preset.id}: ${metric} is ${tone} without a finding for ${JSON.stringify(text.slice(0, 40))}`,
          );
        }
      }
      if (a.findings.some((f) => f.id === "clean")) {
        assert.ok(
          Object.values(a.signals).every((t) => t === "ok" || t === "na"),
          `Reads clean beside a signal: ${JSON.stringify(text.slice(0, 40))}`,
        );
      }
    }
  }
});
