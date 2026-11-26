import assert from "node:assert/strict";
import { test } from "node:test";
import {
  APP_ORIGIN,
  connectLink,
  parseServedConnection,
  readConnectFragment,
  sameConnection,
  servedConnection,
} from "./served.ts";

const TOKEN = `${"Ab_-".repeat(10)}xyz`;

test("only an address on this machine, with a port from 1 to 65535, is a served library", () => {
  assert.deepEqual(servedConnection("127.0.0.1:4320", TOKEN), { address: "127.0.0.1:4320", token: TOKEN });
  assert.deepEqual(servedConnection(" localhost:80 ", ` ${TOKEN} `), { address: "localhost:80", token: TOKEN });
  for (const address of [
    "10.0.0.2:4320",
    "attacker.example:4320",
    "127.0.0.1",
    "127.0.0.1:0",
    "127.0.0.1:65536",
    "127.0.0.1.attacker.example:4320",
    "[::1]:4320",
  ]) {
    assert.equal(servedConnection(address, TOKEN), null, address);
  }
});

test("a token is exactly 43 base64url characters", () => {
  assert.equal(servedConnection("127.0.0.1:4320", TOKEN.slice(1)), null);
  assert.equal(servedConnection("127.0.0.1:4320", `${TOKEN.slice(1)}=`), null);
  assert.equal(servedConnection("127.0.0.1:4320", `${TOKEN.slice(1)}+`), null);
});

test("a connect link carries the connection in its fragment, and reads back", () => {
  const connection = servedConnection("127.0.0.1:4320", TOKEN);
  assert.ok(connection);
  const link = connectLink(`${APP_ORIGIN}/`, connection);
  assert.equal(link, `https://a4.marsh.build/#serve=127.0.0.1:4320.${TOKEN}`);
  const read = readConnectFragment(new URL(link).hash);
  assert.ok(read !== null && read !== "invalid" && sameConnection(read, connection));
  assert.deepEqual(parseServedConnection(`127.0.0.1:4320.${TOKEN}`), connection);
});

test("a fragment that isn't a connect link is left alone; a broken one is invalid, never thrown", () => {
  assert.equal(readConnectFragment(""), null);
  assert.equal(readConnectFragment("#s1.abc"), null);
  assert.equal(readConnectFragment("#serve=%E0"), "invalid");
  assert.equal(readConnectFragment(`#serve=10.0.0.2:4320.${TOKEN}`), "invalid");
  assert.equal(readConnectFragment("#serve="), "invalid");
});
