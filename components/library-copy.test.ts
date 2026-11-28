import { test } from "node:test";
import assert from "node:assert/strict";
import { PageNotFoundError } from "../lib/persist/store/types.ts";
import { NOT_READY, reportResult, runReported } from "../lib/workspace/errors.ts";
import { folderPicker, libraryActions, libraryConfirm, libraryNotices } from "./library-copy.ts";

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
  assert.equal(libraryActions.exportPages, "export the pages");
  assert.equal(libraryActions.importFile("Brief.zip"), "import “Brief.zip”");
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

test("what a page or library command did, and saving", () => {
  assert.equal(libraryNotices.saved, "Saved");
  assert.equal(libraryNotices.saveFailed, "Saving failed. A4 keeps your edits and will keep trying.");
  assert.equal(libraryNotices.created("Brief"), "Created “Brief”.");
  assert.equal(
    libraryNotices.copiedIntoLibrary("notes/plan.md", "plan"),
    "Copied “notes/plan.md” into the library as “plan”.",
  );
  assert.equal(libraryNotices.copiedText("Brief", 1204), "Copied “Brief” (1,204 characters)");
  assert.equal(libraryNotices.exported(1, "a4-pages-2026-11-28.zip"), "Exported 1 page to a4-pages-2026-11-28.zip");
  assert.equal(libraryNotices.exported(3, "a4-pages-2026-11-28.zip"), "Exported 3 pages to a4-pages-2026-11-28.zip");
  assert.equal(
    libraryNotices.importTooLarge("Huge.zip", "50 MB"),
    "Couldn’t import “Huge.zip”: files over 50 MB aren’t supported.",
  );
});

test("the confirmations before text is cleared or deleted", () => {
  assert.equal(libraryConfirm.clearPage("Brief"), "Clear all text on “Brief”?");
  assert.equal(libraryConfirm.trashPage("Brief"), "Move “Brief” to the trash? You can restore it from the trash.");
  assert.equal(libraryConfirm.purgePage("Brief"), "Permanently delete “Brief”? This can’t be undone.");
  assert.equal(libraryConfirm.emptyTrash(1), "Permanently delete 1 page in the trash? This can’t be undone.");
  assert.equal(libraryConfirm.emptyTrash(3), "Permanently delete 3 pages in the trash? This can’t be undone.");
});

test("a failed export or import says what it was doing, then why", async () => {
  const messages: [string, string | undefined][] = [];
  const notify = (m: string, tone?: "info" | "warn") => messages.push([m, tone]);
  const refused = new Error("The request is not allowed by the user agent.");
  refused.name = "NotAllowedError";
  assert.equal(await runReported(() => Promise.reject(refused), notify, libraryActions.exportPages), undefined);
  await runReported(() => Promise.reject(new Error(NOT_READY)), notify, libraryActions.exportPages);
  await runReported(
    () => Promise.reject(new Error("The file isn’t a zip archive.")),
    notify,
    libraryActions.importFile("Brief.zip"),
  );
  assert.deepEqual(messages, [
    ["Couldn’t export the pages: The browser didn’t allow access.", "warn"],
    ["Couldn’t export the pages: Storage isn’t ready yet.", "warn"],
    ["Couldn’t import “Brief.zip”: The file isn’t a zip archive.", "warn"],
  ]);
});
