import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePageName, parseFilePath, PageNotFoundError } from "../../lib/persist/index.ts";
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
