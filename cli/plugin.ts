/**
 * `a4 plugin keygen | pack | verify`: the publisher's side of third-party
 * plugins (README, "Third-party plugins"). They make an Ed25519 signing key,
 * package and sign a plugin, and check a package as A4 does before installing
 * it. None of them runs a plugin's code or makes a network request.
 */

import { readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { credentialNote, downloadNote, pluginKind, publisherNote, whereItRuns } from "../components/plugin-copy.ts";
import {
  cardFromJson,
  fingerprint,
  PACKAGE_EXTENSION,
  PackageError,
  packPackage,
  verifyPackage,
} from "../lib/models/package.ts";
import { knownPublisher } from "../lib/models/publishers.ts";
import { KeyFormatError, newSigningKey, type SigningKey, signingKeyFromPem } from "../lib/models/signing-key-node.ts";
import { UsageError } from "./usage.ts";

export type PluginArgs =
  | { readonly action: "keygen"; readonly keyFile: string }
  | {
      readonly action: "pack";
      readonly card: string;
      readonly code: string;
      readonly key: string;
      readonly publisher: string;
      /** `<local path>=<https url>` pairs. */
      readonly files: readonly string[];
      readonly out: string | null;
    }
  | { readonly action: "verify"; readonly file: string };

/** The options `a4 plugin pack` takes; keygen and verify take none. */
export const PACK_OPTIONS = ["card", "code", "key", "publisher", "file", "out"] as const;

export interface PluginOptionValues {
  readonly card?: string | undefined;
  readonly code?: string | undefined;
  readonly key?: string | undefined;
  readonly publisher?: string | undefined;
  readonly file: readonly string[];
  readonly out?: string | undefined;
}

/** Parse `a4 plugin <action> ...` after the command name. */
export function pluginArgs(
  positionals: readonly string[],
  values: PluginOptionValues,
  given: readonly string[],
): PluginArgs {
  const [action, ...rest] = positionals;
  if (action === "keygen" || action === "verify") {
    if (given.length > 0) throw new UsageError(`a4 plugin ${action} takes no options.`);
    const [path, ...extra] = rest;
    if (!path || extra.length > 0) {
      throw new UsageError(
        action === "keygen"
          ? "Name the key file: a4 plugin keygen <file>."
          : "Name one package: a4 plugin verify <file>.",
      );
    }
    return action === "keygen" ? { action, keyFile: path } : { action, file: path };
  }
  if (action === "pack") {
    if (rest.length > 0) throw new UsageError("a4 plugin pack takes options only, no paths.");
    const { card, code, key, publisher } = values;
    if (!card || !code || !key || !publisher) {
      throw new UsageError("a4 plugin pack needs --card, --code, --key, and --publisher.");
    }
    return { action, card, code, key, publisher, files: values.file, out: values.out ?? null };
  }
  throw new UsageError(
    action
      ? `Unknown plugin action “${action}”: use keygen, pack, or verify.`
      : "Name an action: keygen, pack, or verify.",
  );
}

const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

async function keygen(keyFile: string): Promise<number> {
  const { key, pem } = newSigningKey();
  try {
    // "wx" fails when the file exists, so a key is never overwritten.
    await writeFile(keyFile, pem, { mode: 0o600, flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      // Not a usage error: the command was right, so the usage isn't printed. Still exit 2.
      throw new Error(`“${keyFile}” already exists; a4 plugin keygen never overwrites a key.`);
    }
    throw error;
  }
  const raw = key.publicKey;
  process.stdout.write(
    `Wrote a new Ed25519 signing key to ${keyFile}, readable only by you. Keep it private: it isn’t printed.\n` +
      `Public key:  ${base64(raw)}\n` +
      `Fingerprint: ${await fingerprint(raw)}\n`,
  );
  return 0;
}

async function readInput(path: string, what: string): Promise<Uint8Array> {
  try {
    return new Uint8Array(await readFile(path));
  } catch {
    throw new UsageError(`Can’t read the ${what} “${path}”.`);
  }
}

async function pack(args: Extract<PluginArgs, { action: "pack" }>): Promise<number> {
  const cardJson = new TextDecoder().decode(await readInput(args.card, "card"));
  let card: ReturnType<typeof cardFromJson>;
  try {
    card = cardFromJson(cardJson);
  } catch (error) {
    throw new UsageError(`“${args.card}”: ${(error as Error).message}`);
  }
  let key: SigningKey;
  try {
    key = signingKeyFromPem(new TextDecoder().decode(await readInput(args.key, "key")));
  } catch (error) {
    if (error instanceof UsageError) throw error;
    if (error instanceof KeyFormatError && error.problem === "not-ed25519") {
      throw new UsageError(`“${args.key}” isn’t an Ed25519 key.`);
    }
    throw new UsageError(`“${args.key}” isn’t a private key.`);
  }
  const files = await Promise.all(
    args.files.map(async (pair) => {
      const at = pair.indexOf("=");
      if (at <= 0) throw new UsageError(`--file takes <path>=<https url>, not “${pair}”.`);
      return { url: pair.slice(at + 1), data: await readInput(pair.slice(0, at), "model file") };
    }),
  );
  let bytes: Uint8Array;
  try {
    bytes = await packPackage({
      card,
      publisherName: args.publisher,
      publicKey: key.publicKey,
      code: await readInput(args.code, "code"),
      files,
      signedAt: new Date(),
      sign: key.sign,
    });
  } catch (error) {
    if (error instanceof PackageError) {
      process.stderr.write(`a4: no package written: ${error.message}\n`);
      return 1;
    }
    throw error;
  }
  const out = args.out ?? `${card.id}-${card.version}${PACKAGE_EXTENSION}`;
  await writeFile(out, bytes);
  process.stdout.write(`Wrote ${out} (${bytes.length.toLocaleString("en-US")} bytes): ${card.name} ${card.version}.\n`);
  return 0;
}

async function verify(file: string): Promise<number> {
  const bytes = await readInput(file, "package");
  let pkg: Awaited<ReturnType<typeof verifyPackage>>;
  try {
    pkg = await verifyPackage(bytes);
  } catch (error) {
    if (error instanceof PackageError) {
      process.stderr.write(`a4: ${basename(file)} isn’t a valid plugin package: ${error.message}\n`);
      return 1;
    }
    throw error;
  }
  const { card, publisher, manifest } = pkg;
  const known = knownPublisher(publisher.publicKey);
  const signed = manifest.signedAt ? timestampDate(manifest.signedAt).toISOString() : "unknown";
  process.stdout.write(
    [
      `Valid plugin package: ${card.name} ${card.version} (${card.id})`,
      `  ${pluginKind(card)}`,
      `  ${whereItRuns(card)}`,
      `  ${downloadNote(card)}`,
      `  ${credentialNote(card)}`,
      `  ${publisherNote(known?.name ?? null, publisher.name)}`,
      `  Fingerprint: ${publisher.fingerprint}`,
      `  Signed: ${signed}`,
      "",
    ].join("\n"),
  );
  return 0;
}

/** Run `a4 plugin <action>`. Exit status: 0 done, 1 a package refused, 2 a usage error. */
export async function runPlugin(args: PluginArgs): Promise<number> {
  switch (args.action) {
    case "keygen":
      return keygen(args.keyFile);
    case "pack":
      return pack(args);
    case "verify":
      return verify(args.file);
  }
}
