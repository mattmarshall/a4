import { test } from "node:test";
import assert from "node:assert/strict";
import { ANALYSIS_TEXTS } from "../analysis/testing/texts.ts";
import { PaperSize } from "../gen/a4/v1/sheet_pb.js";
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

  test(`${label}: a postmark written by another process mid-seal is never replaced`, async () => {
    await inFolder({ [A]: fits }, async (fs, folder) => {
      const theirs = '{"letter":"2026-11-24-1700-auth.md"}\n';
      // Another process writes the postmark after every check, just before this seal's write.
      const racing: FolderFs = {
        name: fs.name,
        entries: (dir) => fs.entries(dir),
        stat: (path) => fs.stat(path),
        readBytes: (path, options) => fs.readBytes(path, options),
        async writeAtomic(path, bytes, options) {
          if (path === postmarkPath(A)) await folder.put(path, theirs);
          return fs.writeAtomic(path, bytes, options);
        },
      };
      await assert.rejects(accept(racing, A), PostmarkExistsError);
      assert.equal(await folder.text(postmarkPath(A)), theirs);
    });
  });

  test(`${label}: every readable letter has the digest of its current bytes, a draft's too`, async () => {
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(fits)]);
    const notUtf8 = new Uint8Array([0x66, 0xff, 0x0a]);
    await inFolder({ [A]: fits, [B]: bom, [C]: notUtf8 }, async (fs) => {
      const [a, b, c] = await readLetters(fs);
      assert.equal(a?.letter.state, LetterState.DRAFT);
      assert.equal(a?.digest, await letterDigest(new TextEncoder().encode(fits)));
      assert.equal(b?.digest, await letterDigest(bom), "the byte-order mark counts");
      assert.notEqual(b?.digest, a?.digest);
      assert.equal(c?.text, null);
      assert.equal(c?.digest, null, "a letter that isn't UTF-8 has no digest");
    });
  });

  test(`${label}: a card is judged on A5 and a postcard on A6, and Accept needs the letter to fit its size`, async () => {
    const card = ".agents/letters/2026-11-25-0930-auth.a5.md";
    const postcard = ".agents/letters/2026-11-25-0931-deploy.a6.md";
    const rows = (n: number) => Array.from({ length: n }, (_, i) => `Row ${i + 1}.`).join("\n");
    await inFolder({ [card]: rows(30), [postcard]: rows(31) }, async (fs) => {
      const [a5, a6] = await readLetters(fs);
      assert.deepEqual([a5?.letter.rowsUsed, a5?.letter.paper], [30, PaperSize.A5], "30 of 42 rows");
      assert.deepEqual([a6?.letter.rowsUsed, a6?.letter.paper], [31, PaperSize.A6]);
      await assert.rejects(
        accept(fs, postcard),
        (e) => e instanceof SealRefusedError && e.reason === "over-page" && e.overBy === 2,
      );
      await accept(fs, card);
      assert.equal(
        latestDelivery(await readLetters(fs))?.letter.letter.path,
        card,
        "a card is delivered like any letter",
      );
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
  assert.equal(letterPathAt(at, 1, "auth-migration"), ".agents/letters/2026-11-25-0930-auth-migration.md");
  assert.equal(letterPathAt(at, 2, "auth"), ".agents/letters/2026-11-25-0930-auth-2.md");
  assert.equal(letterPathAt(at, 1, "auth", "a5"), ".agents/letters/2026-11-25-0930-auth.a5.md");
  assert.equal(letterPathAt(at, 3, "deploy", "a6"), ".agents/letters/2026-11-25-0930-deploy-3.a6.md");
});
