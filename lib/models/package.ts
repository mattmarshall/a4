/**
 * Plugin packages (proto/a4/v1/plugin.proto): reading one, checking it, and
 * building one. A package is accepted only when its manifest's signature
 * verifies with the manifest's own publisher key, its code matches the
 * signed digest, and its card is one an installed plugin may carry. Checking
 * never runs the plugin's code. The app checks a package before it installs
 * it and every time it starts it; `a4 plugin verify` and `a4 plugin pack` run
 * the same checks.
 */

import { create, fromBinary, fromJsonString, toBinary } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { type ModelCard, ModelCardSchema, Operation } from "../gen/a4/v1/model_pb.js";
import {
  type ModelFile,
  ModelFileSchema,
  type PluginManifest,
  PluginManifestSchema,
  type PluginPackage,
  PluginPackageSchema,
} from "../gen/a4/v1/plugin_pb.js";
import { sha256, verifyEd25519 } from "../platform/digest.ts";
import { checkCard } from "./host.ts";
import { isModelError } from "./errors.ts";

/** The largest package A4 reads: 16 MiB. */
export const PACKAGE_LIMIT = 16 * 1024 * 1024;

/** What the signature covers, before the manifest's bytes. */
const SIGNING_CONTEXT = new TextEncoder().encode("a4.v1.PluginManifest\n");

/** The file extension of a plugin package. */
export const PACKAGE_EXTENSION = ".a4plugin";

export type PackageProblem = "too-large" | "malformed" | "signature" | "code-digest" | "card" | "version" | "files";

/** Why a package was refused, in a sentence the author can act on. */
export class PackageError extends Error {
  override readonly name = "PackageError";
  readonly problem: PackageProblem;
  constructor(problem: PackageProblem, message: string) {
    super(message);
    this.problem = problem;
  }
}

export interface Version {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

/** A package that passed every check, with its parts read out. */
export interface VerifiedPackage {
  /** The package's bytes exactly as read. */
  readonly bytes: Uint8Array;
  readonly manifest: PluginManifest;
  readonly card: ModelCard;
  readonly version: Version;
  readonly publisher: { readonly name: string; readonly publicKey: Uint8Array; readonly fingerprint: string };
  readonly code: Uint8Array;
}

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

/** `bytes` as a SHA-256 URN: "urn:sha256:" and 64 lowercase hexadecimal digits. */
export async function digestUrn(bytes: Uint8Array): Promise<string> {
  return `urn:sha256:${hex(await sha256(bytes))}`;
}

const DIGEST_URN = /^urn:sha256:[0-9a-f]{64}$/;

/** A publisher's fingerprint: the first 16 bytes of SHA-256 of their key, in 8 groups of 4 hex digits. */
export async function fingerprint(publicKey: Uint8Array): Promise<string> {
  const digest = hex((await sha256(publicKey)).slice(0, 16));
  return digest.match(/.{4}/g)?.join(" ") ?? digest;
}

/** The bytes a publisher signs: the context string, then the manifest exactly as stored. */
export function signingBytes(manifest: Uint8Array): Uint8Array {
  const out = new Uint8Array(SIGNING_CONTEXT.length + manifest.length);
  out.set(SIGNING_CONTEXT, 0);
  out.set(manifest, SIGNING_CONTEXT.length);
  return out;
}

const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** A MAJOR.MINOR.PATCH version, or null. */
export function parseVersion(text: string): Version | null {
  const m = VERSION.exec(text);
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

/** Negative when `a` is older than `b`, 0 when equal, positive when newer. */
export function compareVersions(a: Version, b: Version): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

const PLUGIN_ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** A plain DNS hostname with at least two labels and a top-level label that isn't all digits. */
export function isPlainHostname(host: string): boolean {
  if (host.length > 253) return false;
  const labels = host.split(".");
  if (labels.length < 2 || !labels.every((l) => LABEL.test(l))) return false;
  return !/^\d+$/.test(labels.at(-1) ?? "");
}

/**
 * The checks a packaged card passes on top of the host's: its id's
 * characters, Score and Transform only, and a plain hostname for a remote
 * destination. Throws a PackageError naming the first problem.
 */
function checkPackagedCard(card: ModelCard): void {
  try {
    checkCard(card);
  } catch (error) {
    if (isModelError(error)) throw new PackageError("card", error.message);
    throw error;
  }
  if (card.id.length > 64 || !PLUGIN_ID.test(card.id)) {
    throw new PackageError(
      "card",
      `“${card.id}” isn’t a plugin id: use only lowercase letters, digits, dots, and hyphens, in at most 64 characters.`,
    );
  }
  if (card.operations.length === 0) {
    throw new PackageError("card", "The card declares no operations: installed plugins score, transform, or both.");
  }
  if (!card.operations.every((op) => op === Operation.SCORE || op === Operation.TRANSFORM)) {
    throw new PackageError("card", "Installed plugins may score and transform only.");
  }
  if (card.placement.case === "remote" && !isPlainHostname(card.placement.value.destinationHost)) {
    throw new PackageError(
      "card",
      `The card must name one host to send text to, like api.example.com, not “${card.placement.value.destinationHost}”.`,
    );
  }
}

function checkFiles(card: ModelCard, files: readonly ModelFile[]): void {
  let total = BigInt(0);
  for (const file of files) {
    let url: URL;
    try {
      url = new URL(file.url);
    } catch {
      throw new PackageError("files", `“${file.url}” isn’t a URL.`);
    }
    if (url.protocol !== "https:")
      throw new PackageError("files", `Model files must be served over HTTPS: ${file.url}`);
    if (!DIGEST_URN.test(file.digest)) throw new PackageError("files", `${file.url} has no SHA-256 digest.`);
    if (file.size <= BigInt(0)) throw new PackageError("files", `${file.url} has no size.`);
    total += file.size;
  }
  if (total !== card.downloadBytes) {
    throw new PackageError(
      "files",
      `The model files add up to ${total.toLocaleString("en-US")} bytes, but the card declares ${card.downloadBytes.toLocaleString("en-US")}.`,
    );
  }
}

/** A model card from proto3 JSON, as `a4 plugin pack --card` takes it. */
export function cardFromJson(json: string): ModelCard {
  try {
    return fromJsonString(ModelCardSchema, json);
  } catch (error) {
    throw new PackageError("card", `This isn’t a model card in proto3 JSON: ${(error as Error).message}`);
  }
}

/** Read a package's bytes: refused over 16 MiB, before any part is read. */
function readPackage(bytes: Uint8Array): PluginPackage {
  if (bytes.length > PACKAGE_LIMIT) throw new PackageError("too-large", "The package is larger than 16 MiB.");
  let pkg: PluginPackage;
  try {
    pkg = fromBinary(PluginPackageSchema, bytes);
  } catch {
    throw new PackageError("malformed", "This file isn’t an A4 plugin package.");
  }
  if (pkg.manifest.length === 0 || pkg.signature.length === 0 || pkg.code.length === 0) {
    throw new PackageError("malformed", "This file isn’t an A4 plugin package: a part is missing.");
  }
  return pkg;
}

/**
 * Check a package fully: size, signature, code digest, card, version, and
 * files, in that order. Resolves with its parts read out, or rejects with a
 * PackageError. Never runs the code.
 */
export async function verifyPackage(bytes: Uint8Array): Promise<VerifiedPackage> {
  const pkg = readPackage(bytes);
  let manifest: PluginManifest;
  try {
    manifest = fromBinary(PluginManifestSchema, pkg.manifest);
  } catch {
    throw new PackageError("malformed", "The package’s manifest can’t be read.");
  }
  const publisher = manifest.publisher;
  if (publisher?.publicKey.length !== 32) {
    throw new PackageError("malformed", "The package names no publisher key.");
  }
  if (!(await verifyEd25519(publisher.publicKey, pkg.signature, signingBytes(pkg.manifest)))) {
    throw new PackageError("signature", "The package’s signature doesn’t match.");
  }
  if ((await digestUrn(pkg.code)) !== manifest.codeDigest) {
    throw new PackageError("code-digest", "The plugin’s code doesn’t match its digest.");
  }
  const card = manifest.card;
  if (!card) throw new PackageError("card", "The package has no model card.");
  checkPackagedCard(card);
  const version = parseVersion(card.version);
  if (!version) throw new PackageError("version", `The plugin’s version must look like 1.2.3, not “${card.version}”.`);
  checkFiles(card, manifest.files);
  return {
    bytes,
    manifest,
    card,
    version,
    publisher: {
      name: publisher.name,
      publicKey: publisher.publicKey,
      fingerprint: await fingerprint(publisher.publicKey),
    },
    code: pkg.code,
  };
}

export interface PackInput {
  /** The card; its download size is set from the files. */
  readonly card: ModelCard;
  readonly publisherName: string;
  readonly publicKey: Uint8Array;
  readonly code: Uint8Array;
  /** Each model file's bytes and the HTTPS URL it will be served from. */
  readonly files: readonly { readonly url: string; readonly data: Uint8Array }[];
  readonly signedAt: Date;
  /** Sign the bytes with the publisher's private key: an Ed25519 signature. */
  readonly sign: (bytes: Uint8Array) => Uint8Array | Promise<Uint8Array>;
}

/**
 * Build a signed package: compute every digest and size, check the card as
 * installing does, sign the manifest, and verify the result. Never runs the code.
 */
export async function packPackage(input: PackInput): Promise<Uint8Array> {
  const files = await Promise.all(
    input.files.map(async (f) =>
      create(ModelFileSchema, { url: f.url, size: BigInt(f.data.length), digest: await digestUrn(f.data) }),
    ),
  );
  const card = create(ModelCardSchema, {
    ...input.card,
    downloadBytes: files.reduce((sum, f) => sum + f.size, BigInt(0)),
  });
  checkPackagedCard(card);
  if (!parseVersion(card.version)) {
    throw new PackageError("version", `The plugin’s version must look like 1.2.3, not “${card.version}”.`);
  }
  if (!input.publisherName.trim()) throw new PackageError("malformed", "The package needs a publisher name.");
  const manifest = toBinary(
    PluginManifestSchema,
    create(PluginManifestSchema, {
      card,
      publisher: { name: input.publisherName.trim(), publicKey: input.publicKey },
      codeDigest: await digestUrn(input.code),
      files,
      signedAt: timestampFromDate(input.signedAt),
    }),
  );
  const signature = await input.sign(signingBytes(manifest));
  const bytes = toBinary(PluginPackageSchema, create(PluginPackageSchema, { manifest, signature, code: input.code }));
  await verifyPackage(bytes);
  return bytes;
}
