import { test } from "node:test";
import assert from "node:assert/strict";
import { badConnection, connectFailed, servedSwitch } from "./served-copy.ts";

const AT = "127.0.0.1:4320";
const NOT_RUNNING = "a4 serve isn’t running at 127.0.0.1:4320.";

test("the Connect form says why it can't connect, and what to do, for each reason", () => {
  assert.equal(
    connectFailed("not-running", AT, NOT_RUNNING),
    "a4 serve isn’t running at 127.0.0.1:4320. Start it with “a4 serve <folder>”, then choose Connect again.",
  );
  assert.equal(
    connectFailed("refused", AT, "Refused."),
    "a4 serve at 127.0.0.1:4320 refused this token. Check it: it’s the end of the link a4 serve printed, after the last dot.",
  );
  assert.equal(
    connectFailed("older-server", AT, ""),
    "a4 serve at 127.0.0.1:4320 is older than this A4. Update your A4 checkout and restart a4 serve, then choose Connect again.",
  );
  assert.equal(
    connectFailed("newer-server", AT, ""),
    "a4 serve at 127.0.0.1:4320 is newer than this A4. Reload A4, then connect again.",
  );
  assert.equal(
    connectFailed("bad-answer", AT, ""),
    "a4 serve at 127.0.0.1:4320 sent an answer A4 can’t read. Restart a4 serve, and update your A4 checkout if that doesn’t help.",
  );
  assert.equal(connectFailed(null, AT, "Something else went wrong."), "Something else went wrong.");
});

test("the form's other words take the port and the address", () => {
  assert.equal(
    badConnection(4320),
    "Enter the address a4 serve printed, such as 127.0.0.1:4320, and its 43-character token.",
  );
  assert.equal(servedSwitch.servedTitle(AT), "The library a4 serve serves at 127.0.0.1:4320");
});
