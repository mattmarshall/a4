import { test } from "node:test";
import assert from "node:assert/strict";
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { LetterVerdict, PostmarkSchema } from "../lib/desk/index.ts";
import {
  CLIPBOARD_BLOCKED,
  copiedNotice,
  SEAL_MEANING,
  SHARED_PILL,
  sealLine,
  sharedBanner,
  sharedSealFor,
  sharedShownOn,
  specLabel,
} from "./share-copy.ts";

const postmark = (init: Parameters<typeof create<typeof PostmarkSchema>>[1]) =>
  create(PostmarkSchema, { signer: "Matt", sealedAt: timestampFromDate(new Date("2026-11-25T10:00:00Z")), ...init });

test("the copy notice names the page, the link's length, and who can read it", () => {
  assert.equal(
    copiedNotice(["Charter"], 2345),
    "Copied a link to “Charter” (2,345 characters). Anyone with the link can read the page.",
  );
  assert.equal(
    copiedNotice(["Brief", "Brief (fit)"], 5000),
    "Copied a link to “Brief” and “Brief (fit)”, as a pair (5,000 characters). Anyone with the link can read both pages.",
  );
  assert.equal(CLIPBOARD_BLOCKED, "Copy failed: clipboard access was blocked");
});

test("the banner says the pages are shared, read-only, and not saved", () => {
  assert.equal(sharedBanner(["Charter"]), "Shared page “Charter”: read-only, and not saved in your library.");
  assert.match(sharedBanner(["A", "B"]), /^Shared pages “A” and “B”/);
  assert.equal(specLabel({ name: "Pica", paper: "a5" }), "Pica, A5");
});

test("an intact seal names the verdict, the signer, and the day", () => {
  const p = postmark({ verdict: LetterVerdict.ACCEPTED });
  assert.equal(sealLine({ kind: "intact", postmark: p }), "Accepted by Matt on 2026-11-25. Seal intact.");
  const returned = postmark({ verdict: LetterVerdict.RETURNED, reason: "Missing the rollback plan" });
  assert.equal(
    sealLine({ kind: "intact", postmark: returned }),
    "Returned by Matt on 2026-11-25: Missing the rollback plan. Seal intact.",
  );
});

test("a broken seal says the letter changed after it was sealed", () => {
  assert.equal(
    sealLine({ kind: "changed", postmark: postmark({ verdict: LetterVerdict.ACCEPTED }) }),
    "Seal broken: the letter changed after it was sealed.",
  );
  assert.equal(sealLine({ kind: "none" }), null);
});

test("what a link's seal means", () => {
  assert.match(SEAL_MEANING, /doesn’t prove who sealed it/);
  assert.match(SEAL_MEANING, /make the letter true/);
  assert.match(SEAL_MEANING, /anyone can make a link/);
});

test("the banner's note names each page's preset and paper, for one page and a pair", () => {
  const terminal = { name: "Terminal", paper: "a4" } as const;
  const pica = { name: "Pica", paper: "a5" } as const;
  assert.equal(sharedShownOn([terminal]), "Shown on Terminal, A4, as the sender saw it.");
  assert.equal(sharedShownOn([terminal, pica]), "Shown on Terminal, A4 and Pica, A5, as the sender saw them.");
  assert.equal(sharedSealFor("Brief"), "“Brief”: ");
  assert.equal(SHARED_PILL, "Shared · not saved");
});
