import { test } from "node:test";
import assert from "node:assert/strict";
import { claimName, lockNames, MAX_CLAIM_ATTEMPTS, type NameLock } from "./claims.ts";
import { PageExistsError, StoreUnavailableError } from "./types.ts";

/** A lock that records the order names are taken in. */
function recordingLock(): { lock: NameLock; taken: string[] } {
  const taken: string[] = [];
  return {
    taken,
    lock: async (name, fn) => {
      taken.push(name);
      return fn();
    },
  };
}

test("claimName moves on to the next variant when the name was taken under the lock", async () => {
  const { lock, taken } = recordingLock();
  const claimed = new Set(["brief"]); // taken by another tab after the names were read
  const name = await claimName("Brief", { names: async () => [], lock }, async (candidate) => {
    if (claimed.has(candidate.toLocaleLowerCase("en-US"))) throw new PageExistsError(candidate);
    return candidate;
  });
  assert.equal(name, "Brief 2");
  assert.deepEqual(taken, ["Brief", "Brief 2"]);
});

test("claimName passes other errors through, and gives up after its cap", async () => {
  const { lock } = recordingLock();
  await assert.rejects(
    claimName("Brief", { names: async () => [], lock }, async () => {
      throw new Error("disk full");
    }),
    /disk full/,
  );
  let attempts = 0;
  await assert.rejects(
    claimName("Brief", { names: async () => [], lock }, async (candidate) => {
      attempts++;
      throw new PageExistsError(candidate);
    }),
    StoreUnavailableError,
  );
  assert.equal(attempts, MAX_CLAIM_ATTEMPTS);
});

test("lockNames takes each name once, in sorted lowercased order", async () => {
  const { lock, taken } = recordingLock();
  assert.equal(await lockNames(lock, ["Notes", "Brief", "notes"], async () => 7), 7);
  assert.deepEqual(taken, ["brief", "notes"]);
});
