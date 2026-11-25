import { test } from "node:test";
import assert from "node:assert/strict";
import { ANALYSIS_TEXTS } from "../analysis/testing/texts.ts";
import {
  browserFixture,
  nodeFixture,
  type FolderFixture,
  type TestFolder,
} from "../persist/folder/testing/fixtures.ts";
import type { FolderFs } from "../persist/folder/fs.ts";
import {
  BrokenSeal,
  isLetterPath,
  latestDelivery,
  letterDigest,
  LetterState,
  LetterVerdict,
  PostmarkExistsError,
  postmarkPath,
  readLetters,
  sealLetter,
  SealRefusedError,
} from "./index.ts";

const NOW = Date.UTC(2026, 10, 25, 9, 30);
const A = ".agents/letters/2026-11-24-1700-auth.md";
const B = ".agents/letters/2026-11-25-0930-auth.md";
const C = ".agents/letters/2026-11-25-1400-auth.md";
/** A letter that fits and reads Light. */
const fits = ANALYSIS_TEXTS.light;
/** A 63-row letter. */
const over = Array.from({ length: 63 }, (_, i) => `Step ${i + 1}: check item ${i * 7 + 3} before moving on.`).join(
  "\n",
);

test("the digest of 'abc' is its SHA-256, as a letter URN", async () => {
  assert.equal(
    await letterDigest(new TextEncoder().encode("abc")),
    "urn:a4:letter:sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});

test("a letter is a .md file directly inside .agents/letters/", () => {
  assert.ok(isLetterPath(".agents/letters/2026-11-25-0930-auth.md"));
  assert.ok(isLetterPath(".agents/letters/Notes.MD"));
  for (const path of [
    ".agents/letters/old/x.md",
    "docs/letter.md",
    ".agents/letters/x.mdc",
    ".agents/letters/.md",
    ".agents/letters/x.md.postmark.json",
    ".agents/x.md",
  ]) {
    assert.ok(!isLetterPath(path), path);
  }
});

/** The letter tests, on one folder adapter. */
function suite<H>(label: string, makeFixture: () => Promise<FolderFixture<H>>) {
  const inFolder = async <T>(
    files: Record<string, string | Uint8Array>,
    run: (fs: FolderFs, folder: TestFolder<H>) => Promise<T>,
  ): Promise<T> => {
    const fixture = await makeFixture();
    try {
      const folder = await fixture.folder("repo", files);
      return await run(fixture.source.open(folder.handle), folder);
    } finally {
      await fixture.dispose();
    }
  };
  const accept = (fs: FolderFs, path: string, signer = "Matt") =>
    sealLetter(fs, path, { verdict: "accepted", signer, now: NOW });

  test(`${label}: no .agents/letters folder means no letters`, async () => {
    assert.deepEqual(await inFolder({ "AGENTS.md": fits }, (fs) => readLetters(fs)), []);
  });

  test(`${label}: letters are listed oldest first, and subfolders aren't letters`, async () => {
    const letters = await inFolder({ [B]: fits, [A]: fits, ".agents/letters/old/x.md": fits }, (fs) => readLetters(fs));
    assert.deepEqual(
      letters.map((l) => l.letter.path),
      [A, B],
    );
    assert.equal(letters[0]?.letter.state, LetterState.DRAFT);
    assert.ok((letters[0]?.letter.rowsUsed ?? 0) > 0);
    assert.equal(letters[0]?.text, fits);
  });

  test(`${label}: accepting writes a proto3 JSON postmark beside the letter, and the letter is unchanged`, async () => {
    await inFolder({ [A]: fits }, async (fs, folder) => {
      const postmark = await accept(fs, A);
      assert.equal(postmark.letter, "2026-11-24-1700-auth.md");
      assert.equal(postmark.verdict, LetterVerdict.ACCEPTED);
      assert.equal(postmark.digest, await letterDigest(new TextEncoder().encode(fits)));
      const json = await folder.text(postmarkPath(A));
      assert.ok(json, "the sidecar exists");
      const parsed = JSON.parse(json ?? "{}");
      assert.equal(parsed.verdict, "LETTER_VERDICT_ACCEPTED");
      assert.equal(parsed.signer, "Matt");
      assert.equal(parsed.sealedAt, "2026-11-25T09:30:00Z");
      assert.equal(await folder.text(A), fits);
      const [read] = await readLetters(fs);
      assert.equal(read?.letter.state, LetterState.ACCEPTED);
      assert.equal(read?.letter.postmark?.signer, "Matt");
    });
  });

  test(`${label}: returning needs a reason and records it`, async () => {
    await inFolder({ [A]: fits }, async (fs) => {
      await assert.rejects(
        sealLetter(fs, A, { verdict: "returned", reason: "  ", signer: "Matt", now: NOW }),
        (e: unknown) => e instanceof SealRefusedError && e.reason === "no-reason",
      );
      await sealLetter(fs, A, { verdict: "returned", reason: "Missing the rollback plan", signer: "Matt", now: NOW });
      const [read] = await readLetters(fs);
      assert.equal(read?.letter.state, LetterState.RETURNED);
      assert.equal(read?.letter.postmark?.reason, "Missing the rollback plan");
    });
  });

  test(`${label}: a seal needs a signer, and an accepted letter must fit`, async () => {
    await inFolder({ [A]: over }, async (fs) => {
      await assert.rejects(
        sealLetter(fs, A, { verdict: "accepted", signer: " ", now: NOW }),
        (e: unknown) => e instanceof SealRefusedError && e.reason === "blank-signer",
      );
      await assert.rejects(
        accept(fs, A),
        (e: unknown) => e instanceof SealRefusedError && e.reason === "over-page" && e.overBy === 3,
      );
      const [read] = await readLetters(fs);
      assert.equal(read?.letter.state, LetterState.DRAFT, "nothing was written");
    });
  });

  test(`${label}: a second seal is refused and the first postmark is unchanged`, async () => {
    await inFolder({ [A]: fits }, async (fs, folder) => {
      await accept(fs, A);
      const first = await folder.text(postmarkPath(A));
      await assert.rejects(
        sealLetter(fs, A, { verdict: "returned", reason: "No", signer: "Ana", now: NOW + 1000 }),
        PostmarkExistsError,
      );
      assert.equal(await folder.text(postmarkPath(A)), first);
    });
  });

  test(`${label}: editing a sealed letter breaks its seal`, async () => {
    await inFolder({ [A]: fits }, async (fs, folder) => {
      await accept(fs, A);
      await folder.put(A, `${fits}\nOne more line.\n`);
      const [read] = await readLetters(fs);
      assert.equal(read?.letter.state, LetterState.BROKEN);
      assert.equal(read?.letter.broken, BrokenSeal.CHANGED);
    });
  });

  test(`${label}: a postmark that isn't a Postmark breaks the seal`, async () => {
    for (const sidecar of ["{not json", '{"letter":"other.md","digest":"urn:a4:letter:sha256:00","verdict":1}', "{}"]) {
      await inFolder({ [A]: fits, [postmarkPath(A)]: sidecar }, async (fs) => {
        const [read] = await readLetters(fs);
        assert.equal(read?.letter.state, LetterState.BROKEN, sidecar);
        assert.equal(read?.letter.broken, BrokenSeal.UNREADABLE_POSTMARK, sidecar);
      });
    }
  });

  test(`${label}: the parent is the newest intact accepted letter before this one`, async () => {
    await inFolder({ [A]: fits, [B]: fits, [C]: fits }, async (fs) => {
      const first = await sealLetter(fs, A, { verdict: "accepted", signer: "Matt", now: NOW });
      assert.equal(first.parent, "");
      // Sealing C before B: C's parent is A, the only accepted letter before it.
      const third = await accept(fs, C);
      assert.equal(third.parent, first.digest);
      const second = await sealLetter(fs, B, { verdict: "returned", reason: "Redo", signer: "Matt", now: NOW });
      assert.equal(second.parent, first.digest);
    });
  });

  test(`${label}: delivery is the newest intact accepted letter, with returned letters after it`, async () => {
    await inFolder({ [A]: fits, [B]: `${fits}\nB.\n`, [C]: `${fits}\nC.\n` }, async (fs, folder) => {
      assert.equal(latestDelivery(await readLetters(fs)), null, "drafts aren't delivered");
      await accept(fs, A);
      await accept(fs, B);
      await folder.put(B, "Changed after sealing.\n");
      await sealLetter(fs, C, { verdict: "returned", reason: "Missing the rollback plan", signer: "Matt", now: NOW });
      const delivery = latestDelivery(await readLetters(fs));
      assert.equal(delivery?.letter.letter.path, A, "B's seal is broken");
      assert.equal(delivery?.text, fits);
      assert.deepEqual(
        delivery?.returnedSince.map((l) => [l.letter.path, l.letter.postmark?.reason]),
        [[C, "Missing the rollback plan"]],
      );
    });
  });
}

suite("browser", async () => browserFixture());
suite("node", nodeFixture);

test("the desk and the folder list share one letter rule", async () => {
  const scan = await import("../persist/folder/scan.ts");
  assert.equal(isLetterPath, scan.isLetterPath);
});

test("letters order by name without .md, so a minute's second letter is newer", async () => {
  const { compareLetterNames, letterPathAt } = await import("./letters.ts");
  const names = ["2026-11-25-0930-letter-2.md", "2026-11-25-0930-letter.md", "2026-11-24-1700-auth.md"];
  assert.deepEqual([...names].sort(compareLetterNames), [
    "2026-11-24-1700-auth.md",
    "2026-11-25-0930-letter.md",
    "2026-11-25-0930-letter-2.md",
  ]);
  const at = Date.UTC(2026, 10, 25, 9, 30, 59);
  assert.equal(letterPathAt(at), ".agents/letters/2026-11-25-0930-letter.md");
  assert.equal(letterPathAt(at, 2), ".agents/letters/2026-11-25-0930-letter-2.md");
});
