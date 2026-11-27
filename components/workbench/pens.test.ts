import { test } from "node:test";
import assert from "node:assert/strict";
import { FIT_TO_PAGE, Operation } from "../../lib/models/index.ts";
import { overlayCard, penCard } from "../../lib/models/testing/packages.ts";
import { penCards } from "./pens.ts";

test("Fit to page comes first, then the installed pens by name; overlays aren't pens", () => {
  const publisher = "Unknown publisher (calls itself “Example Labs”)";
  const pens = penCards([
    { card: penCard({ id: "example.wrap", name: "Hard wrap" }), publisher },
    { card: overlayCard(), publisher },
    { card: penCard({ id: "example.bullets", name: "Bullets" }), publisher },
    {
      card: overlayCard({ id: "example.both", name: "Both", operations: [Operation.SCORE, Operation.TRANSFORM] }),
      publisher,
    },
  ]);
  assert.deepEqual(
    pens.map((p) => p.card.name),
    ["Fit to page", "Both", "Bullets", "Hard wrap"],
  );
  assert.equal(pens[0]?.card, FIT_TO_PAGE.card);
  assert.equal(pens[0]?.publisher, null);
  assert.equal(pens[1]?.publisher, publisher);
});

test("with nothing installed, Fit to page is the only pen", () => {
  assert.deepEqual(
    penCards([]).map((p) => p.card.id),
    [FIT_TO_PAGE.card.id],
  );
});
