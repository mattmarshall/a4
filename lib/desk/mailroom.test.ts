import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { toJsonString } from "@bufbuild/protobuf";
import { ANALYSIS_TEXTS } from "../analysis/testing/texts.ts";
import { type FolderFs, FsError } from "../persist/folder/fs.ts";
import {
  browserFixture,
  type FolderFixture,
  nodeFixture,
  type TestFolder,
} from "../persist/folder/testing/fixtures.ts";
import { LetterState, readLetters, sealLetter } from "./index.ts";
import { lintFile, LintOutcome } from "./lint.ts";
import {
  checkPage,
  deliverByDigest,
  deliverLatest,
  FiledLetterSchema,
  fileLetter,
  FilingRefusal,
  findLetter,
  isLetterDigest,
  isTopic,
  PageCheckSchema,
  textProblem,
} from "./mailroom.ts";

const NOW = Date.UTC(2026, 10, 25, 9, 30, 12);
const DIR = ".agents/letters";
/** `n` rows, one short line each. */
const rows = (n: number) =>
  Array.from({ length: n }, (_, i) => `Step ${i + 1}: check item ${i * 7 + 3} before moving on.`).join("\n");
const fits = ANALYSIS_TEXTS.light;

test("checkPage: a page over fails, with its rows used and rows over", () => {
  const { check } = checkPage(rows(74));
  assert.equal(check.outcome, LintOutcome.FAIL);
  assert.equal(check.rowsUsed, 74);
  assert.equal(check.pageRows, 60);
  assert.equal(check.overBy, 14);
  assert.equal(check.report?.preset, "terminal");
});

test("checkPage: exactly one page passes, and a noisy page warns", () => {
  const exact = checkPage(rows(60)).check;
  assert.equal(exact.rowsUsed, 60);
  assert.equal(exact.overBy, 0);
  assert.notEqual(exact.outcome, LintOutcome.FAIL);
  const noisy = checkPage(ANALYSIS_TEXTS["noisy-json"]);
  assert.equal(noisy.judgment.analysis.assessment.verdict, "noisy");
  assert.equal(noisy.check.outcome, LintOutcome.WARN);
});

test("checkPage judges text as a4 lint judges the same file", async () => {
  const raw = Array.from({ length: 70 }, (_, i) => `\tStep ${i + 1}: check the deploy.`).join("\r\n");
  const fixture = await nodeFixture();
  try {
    const folder = await fixture.folder("repo", { "AGENTS.md": raw });
    const linted = await lintFile(fixture.source.open(folder.handle), "AGENTS.md");
    const { check } = checkPage(raw);
    assert.equal(check.rowsUsed, linted.judgment?.fit.rowsUsed);
    assert.equal(check.outcome, linted.file.outcome);
    assert.deepEqual(check.report, linted.file.report);
  } finally {
    await fixture.dispose();
  }
});

test("a check never carries the text it checked", () => {
  const { check } = checkPage(`${fits}\ntoken: sk-test-123\n`);
  assert.ok(!toJsonString(PageCheckSchema, check).includes("sk-test-123"));
});

test("textProblem: blank text and text over 1 MiB", () => {
  assert.equal(textProblem("\n\n"), "empty");
  assert.equal(textProblem(" \t "), "empty");
  assert.equal(textProblem("é".repeat(524_289)), "too-large", "1,048,578 bytes as UTF-8");
  assert.equal(textProblem("é".repeat(524_288)), null, "exactly 1 MiB");
});

test("topics: a-z, 0-9, and single inner hyphens, at most 40 characters", () => {
  for (const ok of ["letter", "auth-migration", "v2", "a".repeat(40)]) assert.ok(isTopic(ok), ok);
  for (const bad of ["", "../notes", "Auth Migration", "a--b", "-a", "a-", "a.md", "a/b", "a".repeat(41)]) {
    assert.ok(!isTopic(bad), bad);
  }
});

test("digests: only the URN with 64 lowercase hexadecimal digits", () => {
  assert.ok(isLetterDigest(`urn:a4:letter:sha256:${"ab".repeat(32)}`));
  assert.ok(!isLetterDigest(`urn:a4:letter:sha256:${"AB".repeat(32)}`));
  assert.ok(!isLetterDigest("urn:a4:letter:sha256:00"));
  assert.ok(!isLetterDigest("ab".repeat(32)));
});

/** The filing and reading tests, on one folder adapter. */
function suite<H>(label: string, makeFixture: () => Promise<FolderFixture<H>>) {
  const inFolder = async (
    files: Record<string, string | Uint8Array>,
    run: (fs: FolderFs, folder: TestFolder<H>) => Promise<void>,
  ): Promise<void> => {
    const fixture = await makeFixture();
    try {
      const folder = await fixture.folder("repo", files);
      await run(fixture.source.open(folder.handle), folder);
    } finally {
      await fixture.dispose();
    }
  };
  /** Every file under .agents/letters/. */
  const names = async (fs: FolderFs) => {
    const found: string[] = [];
    try {
      for await (const entry of fs.entries(DIR)) found.push(entry.name);
    } catch {
      // No folder, no files.
    }
    return found.sort();
  };

  test(`${label}: a letter is filed as a new draft holding exactly its text`, async () => {
    await inFolder({}, async (fs, folder) => {
      const { filed } = await fileLetter(fs, rows(40), { now: NOW, topic: "auth-migration" });
      const path = `${DIR}/2026-11-25-0930-auth-migration.md`;
      assert.equal(filed.filed, true);
      assert.equal(filed.path, path);
      assert.equal(filed.refusal, FilingRefusal.UNSPECIFIED);
      assert.equal(filed.check?.rowsUsed, 40);
      assert.equal(await folder.text(path), rows(40));
      const { bytes } = await fs.readBytes(path);
      assert.ok(bytes);
      assert.equal(filed.digest, `urn:a4:letter:sha256:${createHash("sha256").update(bytes).digest("hex")}`);
      const [letter] = await readLetters(fs);
      assert.equal(letter?.letter.state, LetterState.DRAFT);
      assert.ok(!toJsonString(FiledLetterSchema, filed).includes("Step 1: check item"), "no text in the record");
    });
  });

  test(`${label}: without a topic, a letter is named like New letter`, async () => {
    await inFolder({}, async (fs) => {
      const { filed } = await fileLetter(fs, fits, { now: NOW });
      assert.equal(filed.path, `${DIR}/2026-11-25-0930-letter.md`);
    });
  });

  test(`${label}: a letter over the page is not filed, and says how far over`, async () => {
    await inFolder({}, async (fs) => {
      const { filed, judgment } = await fileLetter(fs, rows(63), { now: NOW });
      assert.equal(filed.filed, false);
      assert.equal(filed.refusal, FilingRefusal.OVER_PAGE);
      assert.equal(filed.check?.overBy, 3);
      assert.equal(filed.path, "");
      assert.ok(judgment);
      assert.deepEqual(await names(fs), []);
    });
  });

  test(`${label}: exactly one page, and a noisy letter, are filed`, async () => {
    await inFolder({}, async (fs) => {
      assert.equal((await fileLetter(fs, rows(60), { now: NOW, topic: "exact" })).filed.filed, true);
      const noisy = await fileLetter(fs, ANALYSIS_TEXTS["noisy-json"], { now: NOW, topic: "noisy" });
      assert.equal(noisy.filed.filed, true);
      assert.equal(noisy.filed.check?.outcome, LintOutcome.WARN);
    });
  });

  test(`${label}: blank text, huge text, and bad topics write nothing`, async () => {
    await inFolder({}, async (fs) => {
      assert.equal((await fileLetter(fs, "\n\n", { now: NOW })).filed.refusal, FilingRefusal.EMPTY);
      assert.equal((await fileLetter(fs, "a".repeat(1_048_577), { now: NOW })).filed.refusal, FilingRefusal.TOO_LARGE);
      for (const topic of ["../notes", "Auth Migration", "a--b", "-a", "a".repeat(41)]) {
        const { filed } = await fileLetter(fs, fits, { now: NOW, topic });
        assert.equal(filed.refusal, FilingRefusal.BAD_TOPIC, topic);
      }
      assert.deepEqual(await names(fs), []);
    });
  });

  test(`${label}: a taken name moves on to -2, and the first letter is unchanged`, async () => {
    const first = `${DIR}/2026-11-25-0930-auth.md`;
    await inFolder({ [first]: "First letter.\n" }, async (fs, folder) => {
      const before = await fs.stat(first);
      const { filed } = await fileLetter(fs, fits, { now: NOW, topic: "auth" });
      assert.equal(filed.path, `${DIR}/2026-11-25-0930-auth-2.md`);
      assert.equal(await folder.text(first), "First letter.\n");
      assert.deepEqual(await fs.stat(first), before);
    });
  });

  test(`${label}: when all nine names are taken, nothing is written`, async () => {
    const taken: Record<string, string> = {};
    for (let n = 1; n <= 9; n++) taken[`${DIR}/2026-11-25-0930-auth${n > 1 ? `-${n}` : ""}.md`] = `Letter ${n}.\n`;
    await inFolder(taken, async (fs) => {
      const { filed } = await fileLetter(fs, fits, { now: NOW, topic: "auth" });
      assert.equal(filed.refusal, FilingRefusal.NO_FREE_NAME);
      assert.equal(filed.filed, false);
      assert.equal((await names(fs)).length, 9);
    });
  });

  test(`${label}: a name taken by another process at the last moment moves on`, async () => {
    await inFolder({}, async (fs) => {
      let first = true;
      const racing: FolderFs = {
        name: fs.name,
        entries: (dir) => fs.entries(dir),
        stat: (path) => fs.stat(path),
        readBytes: (path, options) => fs.readBytes(path, options),
        async writeAtomic(path, bytes, options) {
          if (first) {
            first = false;
            throw new FsError("exists", `“${path}” already exists.`);
          }
          return fs.writeAtomic(path, bytes, options);
        },
      };
      const { filed } = await fileLetter(racing, fits, { now: NOW, topic: "auth" });
      assert.equal(filed.path, `${DIR}/2026-11-25-0930-auth-2.md`);
    });
  });

  test(`${label}: letters are found by digest, with text only when accepted and intact`, async () => {
    const A = `${DIR}/2026-11-24-1700-auth.md`;
    const B = `${DIR}/2026-11-25-0900-auth.md`;
    const C = `${DIR}/2026-11-25-0910-auth.md`;
    const D = `${DIR}/2026-11-25-0920-auth.md`;
    await inFolder({ [A]: `${fits}\nA.\n`, [B]: `${fits}\nB.\n`, [C]: `${fits}\nC.\n` }, async (fs, folder) => {
      const accepted = await sealLetter(fs, A, { verdict: "accepted", signer: "Matt", now: NOW });
      const returned = await sealLetter(fs, B, {
        verdict: "returned",
        reason: "Missing the rollback plan",
        signer: "Matt",
        now: NOW,
      });
      const broken = await sealLetter(fs, C, { verdict: "accepted", signer: "Matt", now: NOW });
      await folder.put(C, "Changed after sealing.\n");
      await folder.put(D, `${fits}\nD.\n`);
      const letters = await readLetters(fs);
      const draft = letters.find((l) => l.letter.path === D);
      assert.ok(draft?.digest);

      const a = deliverByDigest(letters, accepted.digest);
      assert.equal(a.delivered, true);
      assert.equal(a.text, `${fits}\nA.\n`);

      const b = deliverByDigest(letters, returned.digest);
      assert.equal(b.delivered, false);
      assert.equal(b.text, "");
      assert.equal(b.letter?.state, LetterState.RETURNED);
      assert.equal(b.letter?.postmark?.reason, "Missing the rollback plan");

      const c = deliverByDigest(letters, broken.digest);
      assert.equal(c.letter?.state, LetterState.BROKEN, "found by its postmark's digest");
      assert.equal(c.text, "");

      const d = deliverByDigest(letters, draft.digest);
      assert.equal(d.letter?.state, LetterState.DRAFT);
      assert.equal(d.text, "");

      const none = deliverByDigest(letters, `urn:a4:letter:sha256:${"0".repeat(64)}`);
      assert.equal(none.letter, undefined);
      assert.equal(none.delivered, false);
    });
  });

  test(`${label}: when two letters have the same bytes, the accepted one is found`, async () => {
    const A = `${DIR}/2026-11-24-1700-auth.md`;
    const B = `${DIR}/2026-11-25-0900-auth.md`;
    await inFolder({ [A]: fits, [B]: fits }, async (fs) => {
      const sealed = await sealLetter(fs, A, { verdict: "accepted", signer: "Matt", now: NOW });
      const found = findLetter(await readLetters(fs), sealed.digest);
      assert.equal(found?.letter.path, A, "not the newer draft with the same bytes");
    });
  });

  test(`${label}: the latest delivery matches a4 letters --latest`, async () => {
    const A = `${DIR}/2026-11-24-1700-auth.md`;
    const B = `${DIR}/2026-11-25-0900-auth.md`;
    await inFolder({ [A]: `${fits}\nA.\n`, [B]: `${fits}\nB.\n` }, async (fs) => {
      assert.equal(deliverLatest(await readLetters(fs)).delivered, false, "drafts aren't delivered");
      await sealLetter(fs, A, { verdict: "accepted", signer: "Matt", now: NOW });
      await sealLetter(fs, B, { verdict: "returned", reason: "Missing the rollback plan", signer: "Ana", now: NOW });
      const delivery = deliverLatest(await readLetters(fs));
      assert.equal(delivery.delivered, true);
      assert.equal(delivery.letter?.path, A);
      assert.equal(delivery.text, `${fits}\nA.\n`);
      assert.deepEqual(
        delivery.returnedSince.map((l) => [l.path, l.postmark?.reason]),
        [[B, "Missing the rollback plan"]],
      );
    });
  });
}

suite("browser", async () => browserFixture());
suite("node", nodeFixture);
