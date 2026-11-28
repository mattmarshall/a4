import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parsePageName,
  parseFilePath,
  PageNotFoundError,
  StoreUnavailableError,
  type UnavailableReason,
} from "../../lib/persist/index.ts";
import type { WorkspaceNotice } from "../../lib/workspace/index.ts";
import { describeNotice } from "./notices.ts";

const APP = "https://a4.marsh.build";
const DEV = "http://localhost:5173";
const describe = (notice: WorkspaceNotice, pageOrigin = APP) => describeNotice(notice, pageOrigin);

const n = parsePageName;

test("notices read as the sentences A4 showed before", () => {
  assert.deepEqual(
    describe({
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
    describe({
      kind: "recovered-folder",
      recoveries: [{ kind: "recreated", page: parseFilePath("AGENTS.md"), savedAs: n("AGENTS.md (recovered x)") }],
    }).message,
    "Recovered unsaved edits to “AGENTS.md” (saved in the library as “AGENTS.md (recovered x)”).",
  );
  assert.equal(
    describe({ kind: "conflict", original: "AGENTS.md", copy: n("AGENTS.md (conflict x)"), moved: true }).message,
    "“AGENTS.md” changed on disk, so your version was saved in the library as “AGENTS.md (conflict x)”. The file was not changed.",
  );
  assert.deepEqual(describe({ kind: "trashed", name: n("Brief") }), {
    message: "Moved “Brief” to the trash.",
    tone: "info",
  });
  assert.equal(
    describe({ kind: "failed", action: "list-folder", subject: "repo", error: new PageNotFoundError("x") }).message,
    "Couldn’t list the folder: No page named “x”.",
  );
  assert.equal(
    describe({ kind: "still-no-access", folder: "repo" }).message,
    "A4 still doesn’t have access to “repo”.",
  );
});

test("the served library's unreachable notice starts with the error's sentence, then says what to do", () => {
  const notice = (reason: UnavailableReason | null, message: string, pageOrigin = APP) =>
    describe(
      {
        kind: "served-unreachable",
        address: "127.0.0.1:4320",
        reason,
        error: new StoreUnavailableError(message, reason),
      },
      pageOrigin,
    );
  // The sentence A4 showed before reasons existed.
  assert.deepEqual(notice("not-running", "a4 serve isn’t running at 127.0.0.1:4320."), {
    message:
      "a4 serve isn’t running at 127.0.0.1:4320. Showing this browser’s library. Run “a4 serve <folder>”, then switch in the Pages panel (or open the link it prints).",
    tone: "warn",
  });
  assert.equal(
    notice("refused", "a4 serve at 127.0.0.1:4320 refused this browser’s token.").message,
    "a4 serve at 127.0.0.1:4320 refused this browser’s token. It was probably restarted with --new-token. Showing this browser’s library. Open the link it printed to connect again.",
  );
  assert.equal(
    notice("older-server", "a4 serve at 127.0.0.1:4320 is older than this A4.").message,
    "a4 serve at 127.0.0.1:4320 is older than this A4. Showing this browser’s library. Update your A4 checkout, restart a4 serve, then switch in the Pages panel.",
  );
  assert.equal(
    notice("newer-server", "a4 serve at 127.0.0.1:4320 is newer than this A4.").message,
    "a4 serve at 127.0.0.1:4320 is newer than this A4. Showing this browser’s library. Reload A4, then switch in the Pages panel.",
  );
  assert.equal(
    notice("bad-answer", "a4 serve sent a library id A4 can’t read.").message,
    "a4 serve sent a library id A4 can’t read. Showing this browser’s library. Restart a4 serve, and update your A4 checkout if that doesn’t help.",
  );
  // A failure the server reported itself (its disk, say): its own words.
  assert.equal(notice(null, "The disk is full.").message, "The disk is full. Showing this browser’s library.");
});

test("from a page a4 serve may not allow, the unreachable notice names --origin for it", () => {
  const notice = (pageOrigin: string) =>
    describe(
      {
        kind: "served-unreachable",
        address: "127.0.0.1:4320",
        reason: "not-running",
        error: new StoreUnavailableError("a4 serve isn’t running at 127.0.0.1:4320.", "not-running"),
      },
      pageOrigin,
    ).message;
  assert.equal(
    notice(DEV),
    "a4 serve isn’t running at 127.0.0.1:4320. If it’s running, it may not allow this page. Showing this browser’s library. Run “a4 serve <folder> --origin http://localhost:5173”, then switch in the Pages panel (or open the link it prints).",
  );
  assert.ok(!notice(APP).includes("--origin"));
});

test("another library behind the same connection is shown, with a notice", () => {
  assert.deepEqual(describe({ kind: "served-replaced", address: "127.0.0.1:4320" }), {
    message:
      "a4 serve at 127.0.0.1:4320 now serves another library, so its pages are shown. Edits to the other one stay with it, for when it’s served again.",
    tone: "warn",
  });
});
