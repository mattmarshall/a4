import { test } from "node:test";
import assert from "node:assert/strict";
import { badConnection, connectFailed, servedReplaced, servedSwitch } from "./served-copy.ts";

const AT = "127.0.0.1:4320";
const APP = "https://a4.marsh.build";
const DEV = "http://localhost:5173";
const NOT_RUNNING = "a4 serve isn’t running at 127.0.0.1:4320.";

test("the Connect form starts with the error's sentence, then says what to do, for each reason", () => {
  assert.equal(
    connectFailed("not-running", NOT_RUNNING, APP),
    "a4 serve isn’t running at 127.0.0.1:4320. Start it with “a4 serve <folder>”, then choose Connect again.",
  );
  assert.equal(
    connectFailed("refused", "a4 serve at 127.0.0.1:4320 refused this browser’s token.", APP),
    "a4 serve at 127.0.0.1:4320 refused this browser’s token. Check the token: it’s the end of the link a4 serve printed, after the last dot.",
  );
  assert.equal(
    connectFailed("older-server", "a4 serve at 127.0.0.1:4320 is older than this A4.", APP),
    "a4 serve at 127.0.0.1:4320 is older than this A4. Update your A4 checkout and restart a4 serve, then choose Connect again.",
  );
  assert.equal(
    connectFailed("newer-server", "a4 serve at 127.0.0.1:4320 is newer than this A4.", APP),
    "a4 serve at 127.0.0.1:4320 is newer than this A4. Reload A4, then connect again.",
  );
  assert.equal(
    connectFailed("bad-answer", "a4 serve sent an answer A4 can’t read.", APP),
    "a4 serve sent an answer A4 can’t read. Restart a4 serve, and update your A4 checkout if that doesn’t help.",
  );
  assert.equal(connectFailed(null, "Something else went wrong.", APP), "Something else went wrong.");
});

test("from a page a4 serve may not allow, the Connect form names --origin for it", () => {
  assert.equal(
    connectFailed("not-running", NOT_RUNNING, DEV),
    "a4 serve isn’t running at 127.0.0.1:4320. If it’s running, it may not allow this page. Start it with “a4 serve <folder> --origin http://localhost:5173”, then choose Connect again.",
  );
  // Only for a server it can't reach: one that answered allowed the page.
  for (const reason of ["refused", "older-server", "newer-server", "bad-answer", null] as const) {
    assert.ok(!connectFailed(reason, "Why.", DEV).includes("--origin"), String(reason));
  }
});

test("another library behind the same connection is named by its address", () => {
  assert.equal(
    servedReplaced(AT),
    "a4 serve at 127.0.0.1:4320 now serves another library, so its pages are shown. Edits to the other one stay with it, for when it’s served again.",
  );
});

test("the form's other words take the port and the address", () => {
  assert.equal(
    badConnection(4320),
    "Enter the address a4 serve printed, such as 127.0.0.1:4320, and its 43-character token.",
  );
  assert.equal(servedSwitch.servedTitle(AT), "The library a4 serve serves at 127.0.0.1:4320");
});
