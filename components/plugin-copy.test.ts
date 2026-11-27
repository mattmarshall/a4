import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryPluginStore } from "../lib/platform/plugin-store.ts";
import { inspect, install } from "../lib/models/installed.ts";
import { overlayCard, penCard, rawPackage, testKey } from "../lib/models/testing/packages.ts";
import { FIT_TO_PAGE } from "../lib/models/index.ts";
import { consentDialog, formatBytes, installDialog, modelsPanel, penPanel, penSuffix } from "./plugin-copy.ts";

const text = (copy: ReturnType<typeof installDialog>) =>
  [copy.title, ...copy.rows.map((r) => `${r.label}: ${r.value}`), ...copy.changes].join("\n");

test("the install dialog for a pen that sends text away names the host, consent, credentials, and publisher", async () => {
  const store = new MemoryPluginStore();
  const inspection = await inspect(store, await rawPackage({ card: penCard(), key: testKey() }), "");
  const copy = installDialog(inspection);
  assert.equal(copy.title, "Install Remote pen 1.0.0?");
  assert.equal(copy.confirm, "Install");
  const all = text(copy);
  assert.match(all, /Does: A pen: it writes a new page from yours, and never changes yours/);
  assert.match(all, /Page text: Sends the page to api\.example\.com, only after you confirm each request/);
  assert.match(all, /Credentials: Asks for: API key/);
  assert.match(all, /Publisher: Unknown publisher \(calls itself “Example Labs”\)/);
  assert.match(all, /Fingerprint: [0-9a-f]{4}( [0-9a-f]{4}){7}/);
  assert.match(all, /From: A file you chose/);
  assert.deepEqual(copy.changes, []);
});

test("the update dialog says when an update starts sending text away, with both versions", async () => {
  const store = new MemoryPluginStore();
  const key = testKey();
  await install(
    store,
    await inspect(store, await rawPackage({ card: overlayCard(), key }), "https://p.example.com/w"),
    new Date(),
  );
  const v2 = overlayCard({
    version: "2.0.0",
    placement: { case: "remote", value: { destinationHost: "api.example.com" } },
  });
  const copy = installDialog(await inspect(store, await rawPackage({ card: v2, key }), ""));
  assert.equal(copy.title, "Update Word length from 1.0.0 to 2.0.0?");
  assert.equal(copy.confirm, "Update");
  assert.deepEqual(copy.changes, [
    "It will now send page text to api.example.com, only after you confirm each request.",
  ]);
  assert.match(text(copy), /From: https:\/\/p\.example\.com\/w/);
});

test("a pen's result is named after the source and the pen; Fit to page keeps its own suffix", () => {
  assert.equal(penSuffix(FIT_TO_PAGE.card), " (fit)");
  assert.equal(penSuffix(penCard({ name: "Hard wrap" })), " (Hard wrap)");
});

test("sizes read in KB and decimal MB", () => {
  assert.equal(formatBytes(12_000), "12 KB");
  assert.equal(formatBytes(38_000_000), "38.0 MB");
});

const RUNNING = { name: "Brief", attempt: 1, maxAttempts: 3, characters: 5400 };

test("Fit to page's panel speaks in its own words: its run label, Claude, its cost, and its key hint", () => {
  const copy = penPanel(FIT_TO_PAGE.card);
  const [key] = FIT_TO_PAGE.card.credentials;
  assert.ok(key);
  assert.equal(copy.run("Brief", "fit"), "Fit “Brief” to the page");
  assert.equal(copy.progress(RUNNING), "Claude is rewriting “Brief” · attempt 1 of 3 · 5,400 characters");
  assert.equal(copy.cost, "Billed to your key: usually a few cents, up to about $0.50 with retries.");
  assert.equal(copy.placeholder, "sk-ant-…");
  assert.match(copy.credentialPrompt(key), /^Your Anthropic API key\. It’s kept in this tab’s memory only/);
  assert.match(copy.credentialPrompt(key), /It goes only to api\.anthropic\.com\.$/);
  assert.equal(copy.credentialSet(key), "Your Anthropic API key is set for this tab only.");
  assert.equal(copy.useKey, "Use key");
  assert.equal(copy.forgetKey, "Forget key");
});

test("an installed pen's panel names its instruction and itself, with no cost line and no key hint", () => {
  const card = penCard({ name: "Hard wrap" });
  const copy = penPanel(card);
  const [key] = card.credentials;
  assert.ok(key);
  assert.equal(copy.run("Notes", "Tighten"), "Tighten: “Notes”");
  assert.equal(copy.run("Notes", ""), "Hard wrap: “Notes”");
  assert.equal(
    copy.progress({ ...RUNNING, name: "Notes", maxAttempts: null }),
    "Hard wrap is writing “Notes” · attempt 1 · 5,400 characters",
  );
  assert.equal(copy.cost, null);
  assert.equal(copy.placeholder, null);
  assert.match(copy.credentialPrompt(key), /^Your API key\..* It goes only to api\.example\.com\.$/);
  assert.equal(copy.useKey, "Use key");
  assert.equal(copy.forgetKey, "Forget key");
});

const consentText = (copy: ReturnType<typeof consentDialog>) =>
  [copy.title, ...copy.rows.map((r) => `${r.label}: ${r.code ?? ""}${r.value}`), copy.note].join("\n");

test("Fit to page's confirmation names Anthropic, its host, the model, the plugin, the page, and the key", () => {
  const copy = consentDialog({
    card: FIT_TO_PAGE.card,
    publisher: null,
    pageName: "Brief",
    characters: 5400,
    action: "rewrite",
  });
  assert.equal(copy.title, "Send this page to Anthropic?");
  const all = consentText(copy);
  assert.match(all, /Destination: api\.anthropic\.com \(Anthropic\), directly from this browser\./);
  assert.match(all, /Plugin: Fit to page, built into A4/);
  assert.match(
    all,
    /Model: claude-opus-5-5\. If Claude declines, Anthropic may retry the request with a fallback model\./,
  );
  assert.match(all, /Page: “Brief”, 5,400 characters/);
  assert.match(
    copy.note,
    /^A4’s server never sees the page or your Anthropic API key\. The rewrite opens as a new page/,
  );
});

test("an installed remote pen's confirmation names its host, its name and version, its publisher, and the page", () => {
  const copy = consentDialog({
    card: penCard({ name: "Hard wrap", model: "wrap-1" }),
    publisher: "Unknown publisher (calls itself “Example Labs”)",
    pageName: "Notes",
    characters: 5400,
    action: "rewrite",
  });
  assert.equal(copy.title, "Send this page to api.example.com?");
  const all = consentText(copy);
  assert.match(all, /Destination: api\.example\.com, directly from this browser\./);
  assert.match(all, /Plugin: Hard wrap 1\.0\.0 · Unknown publisher \(calls itself “Example Labs”\)/);
  assert.match(all, /Model: wrap-1\n/);
  assert.match(all, /Page: “Notes”, 5,400 characters/);
  assert.match(copy.note, /^A4’s server never sees the page or your API key\./);
});

test("a remote overlay's confirmation says the scores tint the page", () => {
  const card = overlayCard({ placement: { case: "remote", value: { destinationHost: "api.example.com" } } });
  const copy = consentDialog({ card, publisher: null, pageName: "Notes", characters: 120, action: "score" });
  assert.equal(
    copy.rows.some((r) => r.label === "Model"),
    false,
    "a card with no model has no Model row",
  );
  assert.equal(
    copy.note,
    "A4’s server never sees the page. The scores tint this page as a lens. You’ll be asked again before it scores the page again.",
  );
});

test("the Models section's words that take a value", () => {
  assert.equal(
    modelsPanel.downloadNote(12_000_000),
    "Needs a one-time download of 12.0 MB. It’s kept in this browser for later visits.",
  );
  assert.equal(modelsPanel.download(12_000_000), "Download (12.0 MB)");
  assert.equal(modelsPanel.downloading(3_000_000, 12_000_000), "Downloading… 3.0 MB of 12.0 MB");
  assert.equal(modelsPanel.model("claude-opus-5-5"), "Model: claude-opus-5-5");
  assert.equal(
    modelsPanel.confirmRemove("Hard wrap"),
    "Remove Hard wrap? Its code, downloaded files, and pinned key are deleted. Pages it made stay.",
  );
  assert.equal(modelsPanel.removed("Hard wrap"), "Removed Hard wrap.");
  assert.equal(
    modelsPanel.removeFailed("Hard wrap", "the store is locked"),
    "Couldn’t remove Hard wrap: the store is locked",
  );
  assert.equal(modelsPanel.damaged("its code changed"), "Damaged, so it doesn’t run: its code changed");
  assert.equal(modelsPanel.installed("Word length"), "Installed Word length.");
  assert.equal(modelsPanel.updated("Word length"), "Updated Word length.");
});
