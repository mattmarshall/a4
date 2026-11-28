import { test } from "node:test";
import assert from "node:assert/strict";
import { PageNotFoundError } from "../lib/persist/store/types.ts";
import { reportResult } from "../lib/workspace/errors.ts";
import { folderPicker, libraryActions } from "./library-copy.ts";

test("each page and folder command names what it was doing", () => {
  assert.equal(libraryActions.openPage, "open the page");
  assert.equal(libraryActions.openNamed("notes/plan.md"), "open “notes/plan.md”");
  assert.equal(libraryActions.createPage, "create the page");
  assert.equal(libraryActions.duplicate("Brief"), "duplicate “Brief”");
  assert.equal(libraryActions.copyIntoLibrary("notes/plan.md"), "copy “notes/plan.md” into the library");
  assert.equal(libraryActions.copyAToB, "copy page A into B");
  assert.equal(libraryActions.trashPage("Brief"), "move “Brief” to the trash");
  assert.equal(libraryActions.restorePage, "restore the page");
  assert.equal(libraryActions.purgePages, "delete the page permanently");
  assert.equal(libraryActions.openPageB, "open page B");
  assert.equal(libraryActions.swapPages, "swap the pages");
  assert.equal(libraryActions.reconnectFolder, "reconnect the folder");
  assert.equal(libraryActions.closeFolder, "close the folder");
});

test("a failed command's notice says what it was doing, then why", async () => {
  const messages: [string, string | undefined][] = [];
  const notify = (m: string, tone?: "info" | "warn") => messages.push([m, tone]);
  const failed = Promise.resolve({ ok: false, error: new PageNotFoundError("Brief") } as const);
  assert.equal(await reportResult(failed, notify, libraryActions.trashPage("Brief")), undefined);
  assert.deepEqual(messages, [["Couldn’t move “Brief” to the trash: No page named “Brief”.", "warn"]]);
});

test("the folder picker's notices", () => {
  assert.equal(
    folderPicker.notShown,
    "This browser didn’t show a folder picker. Open A4 in Chrome or Edge to edit a folder.",
  );
  assert.equal(
    folderPicker.pickFailed("The browser didn’t allow access."),
    "Couldn’t open that folder: The browser didn’t allow access. Try the repository folder itself.",
  );
  assert.equal(folderPicker.openFailed("It no longer exists."), "Couldn’t open that folder: It no longer exists.");
});
