/**
 * Signed plugin packages for tests: a throwaway Ed25519 key (from
 * signing-key-node.ts), cards for an overlay and a pen, and `rawPackage`,
 * which signs whatever it's given without checking it, so tests can build
 * packages A4 must refuse.
 */

import { create, toBinary, type MessageInitShape } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { type ModelCard, ModelCardSchema, Operation, View } from "../../gen/a4/v1/model_pb.js";
import { PluginManifestSchema, PluginPackageSchema } from "../../gen/a4/v1/plugin_pb.js";
import { digestUrn, signingBytes } from "../package.ts";
import { newSigningKey, type SigningKey } from "../signing-key-node.ts";

export type TestKey = SigningKey;

/** A fresh Ed25519 key, in memory only. */
export function testKey(): TestKey {
  return newSigningKey().key;
}

type CardInit = Exclude<MessageInitShape<typeof ModelCardSchema>, ModelCard>;

/** An on-device overlay's card with one plane. */
export function overlayCard(init: CardInit = {}): ModelCard {
  const base: CardInit = {
    id: "example.word-length",
    name: "Word length",
    version: "1.0.0",
    description: "Tints each word by its length.",
    operations: [Operation.SCORE],
    views: [View.TEXT],
    placement: { case: "browser", value: {} },
    score: { planes: [{ name: "Word length", label: "Word length", min: 0, max: 1 }] },
  };
  return create(ModelCardSchema, { ...base, ...init });
}

/** A remote pen's card that sends text to `api.example.com`. */
export function penCard(init: CardInit = {}): ModelCard {
  const base: CardInit = {
    id: "example.remote-pen",
    name: "Remote pen",
    version: "1.0.0",
    operations: [Operation.TRANSFORM],
    views: [View.TEXT],
    placement: { case: "remote", value: { destinationHost: "api.example.com" } },
    transform: { instructions: ["Tighten"], maxAttempts: 2 },
    credentials: [{ kind: "api-key", label: "API key" }],
  };
  return create(ModelCardSchema, { ...base, ...init });
}

export const SAMPLE_CODE = new TextEncoder().encode("self.addEventListener('message', () => {});\n");

export interface RawPackageInput {
  readonly card: ModelCard;
  readonly key: TestKey;
  readonly publisherName?: string;
  readonly code?: Uint8Array;
  readonly files?: MessageInitShape<typeof PluginManifestSchema>["files"];
  /** The key the manifest names, when it isn't the signing key's. */
  readonly namedKey?: Uint8Array;
  /** Applied to the package's manifest bytes after signing. */
  readonly tamperManifest?: (manifest: Uint8Array) => void;
  /** The code stored in the package, when it isn't the code that was signed. */
  readonly storedCode?: Uint8Array;
}

/** Sign a manifest built from `input` with no checks at all, and return the package's bytes. */
export async function rawPackage(input: RawPackageInput): Promise<Uint8Array> {
  const code = input.code ?? SAMPLE_CODE;
  const manifest = toBinary(
    PluginManifestSchema,
    create(PluginManifestSchema, {
      card: input.card,
      publisher: { name: input.publisherName ?? "Example Labs", publicKey: input.namedKey ?? input.key.publicKey },
      codeDigest: await digestUrn(code),
      files: input.files ?? [],
      signedAt: timestampFromDate(new Date("2026-11-25T12:00:00Z")),
    }),
  );
  const signature = input.key.sign(signingBytes(manifest));
  input.tamperManifest?.(manifest);
  return toBinary(
    PluginPackageSchema,
    create(PluginPackageSchema, { manifest, signature, code: input.storedCode ?? code }),
  );
}
