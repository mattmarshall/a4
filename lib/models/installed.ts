/**
 * Installed plugins (design: add-signed-plugins, decisions 6 and 7): what a
 * package would do if installed, and installing, updating, removing, and
 * loading plugins from the store.
 *
 * - The pin is the stored package's publisher key: a package with an
 *   installed plugin's id must be signed by the same key, and an update must
 *   carry a newer version.
 * - A third-party plugin can't take a bundled plugin's id.
 * - Loading re-checks every stored package, as `verifyPackage` does on
 *   install. A record that fails is reported as damaged and isn't run.
 */

import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { timestampDate, timestampFromDate } from "@bufbuild/protobuf/wkt";
import type { ModelCard } from "../gen/a4/v1/model_pb.js";
import { InstalledPluginSchema, PluginManifestSchema, PluginPackageSchema } from "../gen/a4/v1/plugin_pb.js";
import type { PluginStore } from "../platform/plugin-store.ts";
import { readCapped, sameBytes } from "../platform/bytes.ts";
import { remoteHost } from "./capabilities.ts";
import { BUNDLED_CARDS } from "./manifest.ts";
import { compareVersions, PACKAGE_LIMIT, PackageError, type VerifiedPackage, verifyPackage } from "./package.ts";
import { type PluginId, pluginIdOf } from "./plugin-id.ts";
import { type KnownPublisher, knownPublisher } from "./publishers.ts";

export type InstallProblem = "bundled-id" | "other-key" | "older" | "same-version" | "already-installed";

/** Why a package can't be installed over what's there, in a sentence the author can act on. */
export class InstallError extends Error {
  override readonly name = "InstallError";
  readonly problem: InstallProblem;
  constructor(problem: InstallProblem, message: string) {
    super(message);
    this.problem = problem;
  }
}

/** What changes when an update replaces an installed version. Each field is present only when it changes. */
export interface UpdateChanges {
  /** Where page text goes: a host, or null for on this device. */
  readonly destination?: { readonly before: string | null; readonly after: string | null };
  readonly downloadBytes?: { readonly before: bigint; readonly after: bigint };
  readonly credentials?: { readonly before: readonly string[]; readonly after: readonly string[] };
}

/** A checked package, and what installing it would do. Nothing is stored yet. */
export interface Inspection {
  readonly pkg: VerifiedPackage;
  /** The HTTPS URL it came from, or "" for a file. */
  readonly sourceUrl: string;
  readonly known: KnownPublisher | null;
  /** A new plugin, or an update with the installed version it replaces. */
  readonly kind: { readonly is: "install" } | { readonly is: "update"; readonly previousVersion: string };
  readonly changes: UpdateChanges;
}

/** An installed plugin, checked. Its id is minted from its verified card. */
export interface InstalledPlugin {
  readonly id: PluginId;
  readonly pkg: VerifiedPackage;
  readonly sourceUrl: string;
  readonly installedAt: Date | null;
  readonly known: KnownPublisher | null;
}

/**
 * A stored plugin that failed its check, and why. It isn't run. Its id is the
 * key it's stored under: there's no verified card to mint a `PluginId` from.
 */
export interface DamagedPlugin {
  readonly id: string;
  readonly reason: string;
}

const BUNDLED_IDS: readonly string[] = BUNDLED_CARDS.map((c) => c.id);

function changesBetween(before: ModelCard, after: ModelCard): UpdateChanges {
  const kinds = (card: ModelCard) => card.credentials.map((c) => c.label || c.kind).sort();
  return {
    ...(remoteHost(before) === remoteHost(after)
      ? {}
      : { destination: { before: remoteHost(before), after: remoteHost(after) } }),
    ...(before.downloadBytes === after.downloadBytes
      ? {}
      : { downloadBytes: { before: before.downloadBytes, after: after.downloadBytes } }),
    ...(kinds(before).join("\n") === kinds(after).join("\n")
      ? {}
      : { credentials: { before: kinds(before), after: kinds(after) } }),
  };
}

async function readRecord(
  bytes: Uint8Array,
): Promise<{ pkg: VerifiedPackage; sourceUrl: string; installedAt: Date | null }> {
  const record = fromBinary(InstalledPluginSchema, bytes);
  const pkg = await verifyPackage(record.package);
  return {
    pkg,
    sourceUrl: record.sourceUrl,
    installedAt: record.installedAt ? timestampDate(record.installedAt) : null,
  };
}

/**
 * Check `bytes` fully and say what installing it would do: a new install, or
 * an update of the installed plugin with its id. Refuses a bundled plugin's
 * id, another key's package for an installed id, and a version that isn't
 * newer. Stores nothing.
 */
export async function inspect(
  store: PluginStore,
  bytes: Uint8Array,
  sourceUrl: string,
  bundledIds: readonly string[] = BUNDLED_IDS,
): Promise<Inspection> {
  const pkg = await verifyPackage(bytes);
  const { card } = pkg;
  if (bundledIds.includes(card.id)) {
    throw new InstallError("bundled-id", `The id “${card.id}” belongs to a built-in plugin.`);
  }
  const known = knownPublisher(pkg.publisher.publicKey);
  const stored = await store.getRecord(card.id);
  if (!stored) return { pkg, sourceUrl, known, kind: { is: "install" }, changes: {} };
  let current: VerifiedPackage | null = null;
  try {
    current = (await readRecord(stored)).pkg;
  } catch {
    // A damaged record pins nothing: the author can replace it, from any key.
  }
  if (!current) return { pkg, sourceUrl, known, kind: { is: "install" }, changes: {} };
  if (!sameBytes(current.publisher.publicKey, pkg.publisher.publicKey)) {
    throw new InstallError(
      "other-key",
      `Another publisher’s plugin already uses the id “${card.id}”. Remove it first to install this one.`,
    );
  }
  const order = compareVersions(pkg.version, current.version);
  if (order < 0) {
    throw new InstallError("older", `Version ${current.card.version} of ${card.name} is installed, which is newer.`);
  }
  if (order === 0) {
    if (sameBytes(current.bytes, pkg.bytes)) {
      throw new InstallError("already-installed", `${card.name} ${card.version} is already installed.`);
    }
    throw new InstallError(
      "same-version",
      `${card.name} ${card.version} is already installed; an update needs a newer version.`,
    );
  }
  return {
    pkg,
    sourceUrl: sourceUrl || (await readRecord(stored)).sourceUrl,
    known,
    kind: { is: "update", previousVersion: current.card.version },
    changes: changesBetween(current.card, card),
  };
}

/**
 * The digests a stored record's manifest lists, read without checking the
 * signature: cleanup needs to know a damaged plugin's files too. None when
 * the record can't be read at all.
 */
function listedFiles(bytes: Uint8Array | null): string[] {
  if (!bytes) return [];
  try {
    const pkg = fromBinary(PluginPackageSchema, fromBinary(InstalledPluginSchema, bytes).package);
    return fromBinary(PluginManifestSchema, pkg.manifest).files.map((f) => f.digest);
  } catch {
    return [];
  }
}

/** The files every installed plugin other than `exceptId` lists, damaged ones included. */
async function filesInUse(store: PluginStore, exceptId: string): Promise<Set<string>> {
  const used = new Set<string>();
  for (const [id, bytes] of await store.records()) if (id !== exceptId) for (const d of listedFiles(bytes)) used.add(d);
  return used;
}

/**
 * Store an inspected package: a new plugin, or an update of one. An update
 * drops the old version's files that the new one and no other plugin lists.
 */
export async function install(store: PluginStore, inspection: Inspection, now: Date): Promise<InstalledPlugin> {
  const { pkg } = inspection;
  const id = pkg.card.id;
  const before = listedFiles(await store.getRecord(id));
  const record = create(InstalledPluginSchema, {
    package: pkg.bytes,
    sourceUrl: inspection.sourceUrl,
    installedAt: timestampFromDate(now),
  });
  await store.putRecord(id, toBinary(InstalledPluginSchema, record));
  const keep = new Set([...pkg.manifest.files.map((f) => f.digest), ...(await filesInUse(store, id))]);
  for (const digest of before) if (!keep.has(digest)) await store.deleteFile(digest);
  return { id: pluginIdOf(pkg.card), pkg, sourceUrl: inspection.sourceUrl, installedAt: now, known: inspection.known };
}

/** Remove a plugin: its record (code, pinned key, and source URL) and the files no other plugin lists. */
export async function remove(store: PluginStore, id: string): Promise<void> {
  const files = listedFiles(await store.getRecord(id));
  await store.deleteRecord(id);
  const inUse = await filesInUse(store, id);
  for (const digest of files) if (!inUse.has(digest)) await store.deleteFile(digest);
}

/** One stored plugin, read again: gone, damaged, or installed and checked. */
export type LoadedPlugin =
  | { readonly is: "absent" }
  | { readonly is: "damaged"; readonly damaged: DamagedPlugin }
  | { readonly is: "installed"; readonly plugin: InstalledPlugin };

/** Check the record stored under `id`: its signature, that its card names `id`, and that `id` isn't bundled. */
async function checkRecord(id: string, bytes: Uint8Array, bundledIds: readonly string[]): Promise<LoadedPlugin> {
  try {
    const { pkg, sourceUrl, installedAt } = await readRecord(bytes);
    if (pkg.card.id !== id)
      throw new PackageError("card", `It’s stored as “${id}” but its card says “${pkg.card.id}”.`);
    if (bundledIds.includes(id)) throw new PackageError("card", `The id “${id}” belongs to a built-in plugin.`);
    const plugin = {
      id: pluginIdOf(pkg.card),
      pkg,
      sourceUrl,
      installedAt,
      known: knownPublisher(pkg.publisher.publicKey),
    };
    return { is: "installed", plugin };
  } catch (error) {
    return { is: "damaged", damaged: { id, reason: error instanceof Error ? error.message : String(error) } };
  }
}

/** The plugin stored under `id`, checked again; another tab may have installed, updated, or removed it. */
export async function loadOne(
  store: PluginStore,
  id: string,
  bundledIds: readonly string[] = BUNDLED_IDS,
): Promise<LoadedPlugin> {
  const bytes = await store.getRecord(id);
  return bytes ? checkRecord(id, bytes, bundledIds) : { is: "absent" };
}

/** Every installed plugin, each checked again as `loadOne` checks it, and the ones that failed. */
export async function loadInstalled(
  store: PluginStore,
  bundledIds: readonly string[] = BUNDLED_IDS,
): Promise<{ installed: InstalledPlugin[]; damaged: DamagedPlugin[] }> {
  const installed: InstalledPlugin[] = [];
  const damaged: DamagedPlugin[] = [];
  for (const [id, bytes] of await store.records()) {
    const loaded = await checkRecord(id, bytes, bundledIds);
    if (loaded.is === "installed") installed.push(loaded.plugin);
    else if (loaded.is === "damaged") damaged.push(loaded.damaged);
  }
  installed.sort((a, b) => a.pkg.card.name.localeCompare(b.pkg.card.name));
  return { installed, damaged };
}

/** Why a package couldn't be fetched from its URL, in a sentence the author can act on. */
export class FetchPackageError extends Error {
  override readonly name = "FetchPackageError";
}

/**
 * Fetch a package from an HTTPS URL the author gave: no credentials, no
 * referrer, no cache, and no page text. The body is cut off past 16 MiB.
 * A URL that isn't HTTPS is refused without a request. A request that fails,
 * as one to a host that doesn't allow cross-origin requests does, suggests
 * downloading the file and installing it from the file.
 */
export async function fetchPackage(fetchImpl: typeof fetch, url: string, signal?: AbortSignal): Promise<Uint8Array> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new FetchPackageError(`“${url}” isn’t a URL.`);
  }
  if (parsed.protocol !== "https:") throw new FetchPackageError("The URL must use HTTPS.");
  let response: Response;
  try {
    response = await fetchImpl(parsed.href, {
      credentials: "omit",
      referrerPolicy: "no-referrer",
      cache: "no-store",
      ...(signal ? { signal } : {}),
    });
  } catch {
    throw new FetchPackageError(
      `The plugin couldn’t be downloaded from ${parsed.host}. If its host doesn’t allow it, download the file and install it from the file.`,
    );
  }
  if (!response.ok || !response.body) {
    throw new FetchPackageError(`The plugin couldn’t be downloaded from ${parsed.host} (${response.status}).`);
  }
  let bytes: Uint8Array | null;
  try {
    bytes = await readCapped(response.body, PACKAGE_LIMIT);
  } catch {
    throw new FetchPackageError(`The plugin’s download from ${parsed.host} broke off. Try again.`);
  }
  if (!bytes) throw new PackageError("too-large", "The package is larger than 16 MiB.");
  return bytes;
}
