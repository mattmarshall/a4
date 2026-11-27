import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parsePageName,
  parseFilePath,
  PageNotFoundError,
  StoreUnavailableError,
  type UnavailableReason,
} from "../../lib/persist/index.ts";
import { describeNotice } from "./notices.ts";

const n = parsePageName;

test("notices read as the sentences A4 showed before", () => {
  assert.deepEqual(
    describeNotice({
      kind: "recovered-library",
      recoveries: [
        { kind: "applied", page: n("Brief") },
        { kind: "copied", page: n("Plan"), savedAs: n("Plan (recovered 2026-11-24 09.30)") },
      ],
    }),
    {
      message:
        "Recovered unsaved edits from a closed tab: “Brief”, “Plan” (saved as “Plan (recovered 2026-11-24 09.30)”).",
      tone: "warn",
    },
  );
  assert.equal(
    describeNotice({
      kind: "recovered-folder",
      recoveries: [{ kind: "recreated", page: parseFilePath("AGENTS.md"), savedAs: n("AGENTS.md (recovered x)") }],
    }).message,
    "Recovered unsaved edits to “AGENTS.md” (saved in the library as “AGENTS.md (recovered x)”).",
  );
  assert.equal(
    describeNotice({ kind: "conflict", original: "AGENTS.md", copy: n("AGENTS.md (conflict x)"), moved: true }).message,
    "“AGENTS.md” changed on disk, so your version was saved in the library as “AGENTS.md (conflict x)”. The file was not changed.",
  );
  assert.deepEqual(describeNotice({ kind: "trashed", name: n("Brief") }), {
    message: "Moved “Brief” to the trash.",
    tone: "info",
  });
  assert.equal(
    describeNotice({ kind: "failed", action: "list-folder", subject: "repo", error: new PageNotFoundError("x") })
      .message,
    "Couldn’t list the folder: No page named “x”.",
  );
  assert.equal(
    describeNotice({ kind: "still-no-access", folder: "repo" }).message,
    "A4 still doesn’t have access to “repo”.",
  );
});

test("the served library's unreachable notice says why, and what to do", () => {
  const notice = (reason: UnavailableReason | null, message = "a4 serve isn’t running at 127.0.0.1:4320.") =>
    describeNotice({
      kind: "served-unreachable",
      address: "127.0.0.1:4320",
      reason,
      error: new StoreUnavailableError(message, reason),
    });
  // The sentence A4 showed before reasons existed.
  assert.deepEqual(notice("not-running"), {
    message:
      "a4 serve isn’t running at 127.0.0.1:4320. Showing this browser’s library. Run “a4 serve <folder>”, then switch in the Pages panel (or open the link it prints).",
    tone: "warn",
  });
  assert.equal(
    notice("refused").message,
    "a4 serve at 127.0.0.1:4320 refused this browser’s token: it was probably restarted with --new-token. Showing this browser’s library. Open the link it printed to connect again.",
  );
  assert.equal(
    notice("older-server").message,
    "a4 serve at 127.0.0.1:4320 is older than this A4. Showing this browser’s library. Update your A4 checkout, restart a4 serve, then switch in the Pages panel.",
  );
  assert.equal(
    notice("newer-server").message,
    "a4 serve at 127.0.0.1:4320 is newer than this A4. Showing this browser’s library. Reload A4, then switch in the Pages panel.",
  );
  assert.equal(
    notice("bad-answer").message,
    "a4 serve at 127.0.0.1:4320 sent an answer A4 can’t read. Showing this browser’s library. Restart a4 serve, and update your A4 checkout if that doesn’t help.",
  );
  // A failure the server reported itself (its disk, say): its own words.
  assert.equal(notice(null, "The disk is full.").message, "The disk is full. Showing this browser’s library.");
});
