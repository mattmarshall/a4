import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { PluginPackageSchema } from "../lib/gen/a4/v1/plugin_pb.js";

const CLI = fileURLToPath(new URL("./a4.ts", import.meta.url));

const CARD = {
  id: "example.word-length",
  name: "Word length",
  version: "1.0.0",
  description: "Tints each word by its length.",
  operations: ["OPERATION_SCORE"],
  views: ["VIEW_TEXT"],
  browser: {},
  score: { planes: [{ name: "Word length", label: "Word length", min: 0, max: 1 }] },
};

function a4(dir: string, args: readonly string[]) {
  const run = spawnSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: "utf8" });
  return { status: run.status, stdout: run.stdout, stderr: run.stderr };
}

async function inTemp<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "a4-plugin-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Write the card and code, make a key, and pack; returns the package path. */
async function packed(dir: string, card: object = CARD): Promise<{ run: ReturnType<typeof a4>; path: string }> {
  await writeFile(join(dir, "card.json"), JSON.stringify(card));
  await writeFile(join(dir, "plugin.js"), "self.onmessage = () => {};\n");
  if (a4(dir, ["plugin", "keygen", "publisher.key"]).status !== 0) throw new Error("keygen failed");
  const run = a4(dir, [
    "plugin",
    "pack",
    "--card",
    "card.json",
    "--code",
    "plugin.js",
    "--key",
    "publisher.key",
    "--publisher",
    "Example Labs",
    "--out",
    "out.a4plugin",
  ]);
  return { run, path: join(dir, "out.a4plugin") };
}

test("keygen writes a key only its owner can read, and prints the public key, never the private one", async () => {
  await inTemp(async (dir) => {
    const run = a4(dir, ["plugin", "keygen", "publisher.key"]);
    assert.equal(run.status, 0, run.stderr);
    const key = await readFile(join(dir, "publisher.key"), "utf8");
    assert.match(key, /BEGIN PRIVATE KEY/);
    assert.equal((await stat(join(dir, "publisher.key"))).mode & 0o777, 0o600);
    assert.match(run.stdout, /^Public key: {2}[A-Za-z0-9+/]{43}=$/m);
    assert.match(run.stdout, /^Fingerprint: [0-9a-f]{4}( [0-9a-f]{4}){7}$/m);
    const body = key.replace(/-----[^-]+-----/g, "").replace(/\s/g, "");
    for (const out of [run.stdout, run.stderr]) {
      assert.doesNotMatch(out, /PRIVATE KEY/);
      assert.equal(out.includes(body), false);
    }
  });
});

test("keygen refuses a file that exists, leaves it unchanged, and exits 2", async () => {
  await inTemp(async (dir) => {
    await writeFile(join(dir, "publisher.key"), "keep me\n");
    const run = a4(dir, ["plugin", "keygen", "publisher.key"]);
    assert.equal(run.status, 2);
    assert.match(run.stderr, /already exists/);
    assert.equal(await readFile(join(dir, "publisher.key"), "utf8"), "keep me\n");
  });
});

test("pack then verify: a valid package, with the publisher's name and fingerprint", async () => {
  await inTemp(async (dir) => {
    const { run, path } = await packed(dir);
    assert.equal(run.status, 0, run.stderr);
    const verify = a4(dir, ["plugin", "verify", path]);
    assert.equal(verify.status, 0, verify.stderr);
    assert.match(verify.stdout, /^Valid plugin package: Word length 1\.0\.0 \(example\.word-length\)$/m);
    assert.match(verify.stdout, /Unknown publisher \(calls itself “Example Labs”\)/);
    const keygenPrint = /Fingerprint: ([0-9a-f ]{39})/.exec(verify.stdout)?.[1];
    assert.ok(keygenPrint, verify.stdout);
    assert.match(verify.stdout, /page text stays on this device/);
  });
});

test("pack refuses a card A4 would refuse: no package is written, and it exits 1", async () => {
  await inTemp(async (dir) => {
    const { run, path } = await packed(dir, { ...CARD, operations: ["OPERATION_GENERATE"] });
    assert.equal(run.status, 1);
    assert.match(run.stderr, /score and transform only/);
    await assert.rejects(stat(path));
  });
});

test("verify reports code changed after signing, and exits 1", async () => {
  await inTemp(async (dir) => {
    const { path } = await packed(dir);
    const pkg = fromBinary(PluginPackageSchema, new Uint8Array(await readFile(path)));
    const swapped = create(PluginPackageSchema, {
      ...pkg,
      code: new TextEncoder().encode("fetch('https://collector.example/');\n"),
    });
    await writeFile(path, toBinary(PluginPackageSchema, swapped));
    const run = a4(dir, ["plugin", "verify", path]);
    assert.equal(run.status, 1);
    assert.match(run.stderr, /code doesn’t match its digest/);
  });
});

test("plugin usage errors exit 2", async () => {
  await inTemp(async (dir) => {
    assert.equal(a4(dir, ["plugin"]).status, 2);
    assert.equal(a4(dir, ["plugin", "sign"]).status, 2);
    assert.equal(a4(dir, ["plugin", "pack", "--card", "card.json"]).status, 2);
    assert.equal(a4(dir, ["plugin", "verify", "a.a4plugin", "--out", "x"]).status, 2);
    assert.equal(a4(dir, ["lint", "--card", "x"]).status, 2);
  });
});

test("pack refuses a key that isn't Ed25519, and text that isn't a key, without printing either", async () => {
  await inTemp(async (dir) => {
    await writeFile(join(dir, "card.json"), JSON.stringify(CARD));
    await writeFile(join(dir, "plugin.js"), "self.onmessage = () => {};\n");
    const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ format: "pem", type: "pkcs8" });
    await writeFile(join(dir, "rsa.key"), rsa);
    await writeFile(join(dir, "notes.key"), "not a key at all\n");
    const pack = (key: string) =>
      a4(dir, ["plugin", "pack", "--card", "card.json", "--code", "plugin.js", "--key", key, "--publisher", "Example"]);
    const wrongType = pack("rsa.key");
    assert.equal(wrongType.status, 2);
    assert.match(wrongType.stderr, /“rsa\.key” isn’t an Ed25519 key\./);
    const notAKey = pack("notes.key");
    assert.equal(notAKey.status, 2);
    assert.match(notAKey.stderr, /“notes\.key” isn’t a private key\./);
    for (const run of [wrongType, notAKey])
      assert.doesNotMatch(run.stdout + run.stderr, /PRIVATE KEY|not a key at all/);
    assert.deepEqual(
      (await readdir(dir)).filter((f) => f.endsWith(".a4plugin")),
      [],
    );
  });
});
