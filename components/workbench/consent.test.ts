import { test } from "node:test";
import assert from "node:assert/strict";
import { FIT_TO_PAGE, PenJob } from "../../lib/models/index.ts";
import { overlayCard, penCard } from "../../lib/models/testing/packages.ts";
import { type PendingConsent, pendingConsent } from "./consent.ts";

function pen(card = penCard(), publisher: string | null = "Unknown publisher (calls itself “Example Labs”)") {
  const job = new PenJob<string>({
    grant: () => {
      throw new Error("not granted in this test");
    },
    run: () => Promise.reject(new Error("not run in this test")),
    onResult: async () => {},
  });
  return { card, publisher, job };
}

const page = { name: "Notes", ref: "notes", text: "Some text to rewrite." };

test("with nothing waiting, there's nothing to confirm", () => {
  assert.equal(pendingConsent(null, [pen(FIT_TO_PAGE.card, null), pen()]), null);
});

test("a pen waiting in confirm is the request, and Cancel dismisses its own job", () => {
  const fit = pen(FIT_TO_PAGE.card, null);
  const installed = pen();
  installed.job.ask(page);
  const pending = pendingConsent(null, [fit, installed]);
  assert.ok(pending);
  assert.deepEqual(pending.request, {
    card: installed.card,
    publisher: installed.publisher,
    pageName: "Notes",
    characters: page.text.length,
    action: "rewrite",
  });
  pending.dismiss();
  assert.equal(installed.job.state.kind, "idle");
  assert.equal(fit.job.state.kind, "idle");
});

test("Fit to page waiting in confirm is the request, as built in", () => {
  const fit = pen(FIT_TO_PAGE.card, null);
  fit.job.ask(page);
  const pending = pendingConsent(null, [fit, pen()]);
  assert.equal(pending?.request.card, FIT_TO_PAGE.card);
  assert.equal(pending?.request.publisher, null);
});

test("the lens's pending score comes first", () => {
  const waiting = pen();
  waiting.job.ask(page);
  let sent = 0;
  const lens: PendingConsent = {
    request: { card: overlayCard(), publisher: null, pageName: "Notes", characters: 5, action: "score" },
    send: () => sent++,
    dismiss: () => {},
  };
  const pending = pendingConsent(lens, [waiting]);
  assert.equal(pending, lens);
  pending?.send();
  assert.equal(sent, 1);
  assert.equal(waiting.job.state.kind, "confirm", "the pen's request still waits");
});
