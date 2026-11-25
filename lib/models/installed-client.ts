/**
 * The client the host gets for an installed plugin (design: add-signed-plugins,
 * decision 5). The plugin's sandbox has no network when its card keeps text
 * on the device, so it can't download its own files:
 *
 * - Describe answers from the verified card, without starting anything.
 * - Status is ready when every file in the manifest is stored and still
 *   matches its digest.
 * - Prepare downloads the manifest's files from the page (no credentials, no
 *   referrer), checks each one's size and digest, and stores it. A file that
 *   doesn't match is discarded.
 * - Every other call starts the sandbox if it isn't running: the self-test
 *   must pass, every file must be stored, and the start message carries the
 *   files and the credentials the card declares. The plugin's own Describe
 *   must match the card. When a declared credential changes, the sandbox
 *   restarts, so keys live only in memory.
 */

import { create, toBinary } from "@bufbuild/protobuf";
import {
  DescribeRequestSchema,
  type DescribeResponse,
  DescribeResponseSchema,
  type PrepareResponse,
  PrepareResponseSchema,
  StatusResponseSchema,
} from "../gen/a4/v1/model_pb.js";
import { PluginStartSchema } from "../gen/a4/v1/plugin_pb.js";
import { type SheetModelClient, setCloser } from "./client.ts";
import { ErrorCode, ModelError, toModelError } from "./errors.ts";
import type { PluginContext } from "./host.ts";
import { digestUrn, type VerifiedPackage } from "./package.ts";
import type { SandboxNetwork, SandboxOptions, SandboxPort } from "./sandbox.ts";
import { connectPort, isClosed } from "./worker-transport.ts";

/** Where an installed plugin's downloaded files are kept, by digest. */
export interface PluginFiles {
  getFile(digest: string): Promise<Uint8Array | null>;
  putFile(digest: string, data: Uint8Array): Promise<void>;
}

export interface InstalledClientDeps {
  readonly pkg: VerifiedPackage;
  readonly files: PluginFiles;
  readonly context: PluginContext;
  readonly fetch: typeof fetch;
  readonly open: (options: SandboxOptions) => Promise<SandboxPort>;
  /** Whether this browser enforces the sandbox; checked before the plugin first starts. */
  readonly sandboxWorks: () => Promise<boolean>;
}

/** What the author sees when the browser fails the sandbox self-test. */
export const NO_SANDBOX = "This browser can’t sandbox installed plugins, so they don’t run here.";

interface Running {
  readonly client: SheetModelClient;
  readonly port: SandboxPort;
  /** The credentials the sandbox started with, as a comparable string. */
  readonly credentials: string;
}

export function installedClient(deps: InstalledClientDeps): SheetModelClient {
  const { pkg } = deps;
  const { card } = pkg;
  const who = card.name || card.id;
  const network: SandboxNetwork =
    card.placement.case === "remote" ? { host: card.placement.value.destinationHost } : "none";
  const declared = card.credentials.map((c) => c.kind);
  const manifestFiles = pkg.manifest.files;

  const credentials = (): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const kind of declared) {
      const value = deps.context.credential(kind);
      if (value !== null) out[kind] = value;
    }
    return out;
  };

  /** A stored file's bytes, or null when it's missing or no longer matches its digest. */
  const storedFile = async (file: (typeof manifestFiles)[number]): Promise<Uint8Array | null> => {
    const data = await deps.files.getFile(file.digest);
    if (!data || BigInt(data.length) !== file.size || (await digestUrn(data)) !== file.digest) return null;
    return data;
  };

  let running: Running | null = null;
  let starting: Promise<Running> | null = null;

  const stop = () => {
    running?.port.close();
    running = null;
  };

  const start = async (current: Record<string, string>): Promise<Running> => {
    if (!(await deps.sandboxWorks())) throw new ModelError(ErrorCode.UNAVAILABLE, NO_SANDBOX);
    const files = [];
    for (const file of manifestFiles) {
      const data = await storedFile(file);
      if (!data) throw new ModelError(ErrorCode.NOT_READY, `Download ${who}’s model files first.`);
      files.push({ url: file.url, data });
    }
    const startBytes = toBinary(PluginStartSchema, create(PluginStartSchema, { files, credentials: current }));
    const port = await deps.open({ code: pkg.code, start: startBytes, network });
    const client = connectPort(port);
    let described: DescribeResponse;
    try {
      described = await client.describe(create(DescribeRequestSchema));
    } catch (error) {
      port.close();
      throw toModelError(error);
    }
    if (described.card?.id !== card.id) {
      port.close();
      throw new ModelError(ErrorCode.INVALID_CARD, `${who} describes itself as “${described.card?.id ?? ""}”.`);
    }
    return { client, port, credentials: JSON.stringify(current) };
  };

  /** The running sandbox's client, started or restarted as needed. */
  const ensure = async (): Promise<SheetModelClient> => {
    const current = credentials();
    const key = JSON.stringify(current);
    if (running && !isClosed(running.client) && running.credentials === key) return running.client;
    stop();
    starting ??= start(current).finally(() => {
      starting = null;
    });
    running = await starting;
    return running.client;
  };

  const stored = async (): Promise<boolean> => {
    for (const file of manifestFiles) if (!(await storedFile(file))) return false;
    return true;
  };

  async function* prepare(_request: unknown, signal?: AbortSignal): AsyncIterable<PrepareResponse> {
    const total = manifestFiles.reduce((sum, f) => sum + f.size, BigInt(0));
    let loaded = BigInt(0);
    const progress = (ready = false) =>
      create(PrepareResponseSchema, { loadedBytes: loaded, totalBytes: total, ready });
    for (const file of manifestFiles) {
      if (await storedFile(file)) {
        loaded += file.size;
        yield progress();
        continue;
      }
      let response: Response;
      try {
        response = await deps.fetch(file.url, {
          credentials: "omit",
          referrerPolicy: "no-referrer",
          ...(signal ? { signal } : {}),
        });
      } catch (error) {
        if (signal?.aborted) throw new ModelError(ErrorCode.CANCELED, "Canceled.");
        throw new ModelError(ErrorCode.NETWORK, `Couldn’t download ${file.url}: ${(error as Error).message}`);
      }
      if (!response.ok || !response.body) {
        throw new ModelError(ErrorCode.NETWORK, `Couldn’t download ${file.url} (${response.status}).`);
      }
      const chunks: Uint8Array[] = [];
      let size = 0;
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (BigInt(size) > file.size) {
          await reader.cancel();
          throw new ModelError(
            ErrorCode.INVALID_RESULT,
            `${file.url} is larger than its manifest says, so it was discarded.`,
          );
        }
        chunks.push(value);
        yield create(PrepareResponseSchema, { loadedBytes: loaded + BigInt(size), totalBytes: total });
      }
      const data = new Uint8Array(size);
      let at = 0;
      for (const chunk of chunks) {
        data.set(chunk, at);
        at += chunk.length;
      }
      if (BigInt(size) !== file.size || (await digestUrn(data)) !== file.digest) {
        throw new ModelError(ErrorCode.INVALID_RESULT, `${file.url} didn’t match its manifest, so it was discarded.`);
      }
      await deps.files.putFile(file.digest, data);
      loaded += file.size;
      yield progress();
    }
    yield progress(true);
  }

  const client: SheetModelClient = {
    describe: async () => create(DescribeResponseSchema, { card }),
    status: async () => create(StatusResponseSchema, { ready: await stored() }),
    prepare,
    encode: async (request, signal) => (await ensure()).encode(request, signal),
    score: async (request, signal) => (await ensure()).score(request, signal),
    async *transform(request, signal) {
      yield* (await ensure()).transform(request, signal);
    },
    async *generate(request, signal) {
      yield* (await ensure()).generate(request, signal);
    },
  };
  setCloser(client, stop);
  return client;
}
