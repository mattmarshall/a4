/**
 * Build and pack the example plugins (examples/plugins/*): bundle each one's
 * `main.ts` into one script that imports nothing, `dist/example-plugins/<name>.js`,
 * then sign it into `dist/example-plugins/<id>-<version>.a4plugin` with
 * `a4 plugin pack`'s packing code.
 *
 * The signing key is a throwaway made on first build at
 * `dist/example-plugins/example.key` and reused after, so rebuilt examples
 * install as updates of each other. It is never committed (dist/ is ignored),
 * and A4 lists it as no known publisher.
 *
 * Run it with `pnpm build:examples`.
 */

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build, type Rollup } from "vite";
import { cardFromJson, packPackage } from "../lib/models/package.ts";
import { newSigningKey, type SigningKey, signingKeyFromPem } from "../lib/models/signing-key-node.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const EXAMPLES = join(ROOT, "examples/plugins");
const OUT = join(ROOT, "dist/example-plugins");
const KEY = join(OUT, "example.key");

/** The throwaway example key, made on first build and kept beside the packages. */
async function signingKey(): Promise<SigningKey> {
  try {
    return signingKeyFromPem(await readFile(KEY, "utf8"));
  } catch {
    const { key, pem } = newSigningKey();
    await writeFile(KEY, pem, { mode: 0o600, flag: "wx" });
    return key;
  }
}

/** One example's main.ts as a single script with no imports or exports. */
async function bundle(dir: string): Promise<Uint8Array> {
  const result = await build({
    configFile: false,
    logLevel: "warn",
    publicDir: false,
    build: {
      write: false,
      minify: true,
      target: "es2022",
      lib: { entry: join(dir, "main.ts"), formats: ["iife"], name: "a4Plugin", fileName: () => "plugin.js" },
    },
  });
  const outputs = (Array.isArray(result) ? result : [result]) as Rollup.RollupOutput[];
  const chunk = outputs.flatMap((o) => o.output).find((o): o is Rollup.OutputChunk => o.type === "chunk");
  if (!chunk) throw new Error(`${dir}: the build produced no script.`);
  return new TextEncoder().encode(chunk.code);
}

async function main(): Promise<void> {
  await mkdir(OUT, { recursive: true });
  const key = await signingKey();
  const names = (await readdir(EXAMPLES, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
  for (const name of names.sort()) {
    const dir = join(EXAMPLES, name);
    const card = cardFromJson(await readFile(join(dir, "card.json"), "utf8"));
    const code = await bundle(dir);
    await writeFile(join(OUT, `${name}.js`), code);
    const bytes = await packPackage({
      card,
      publisherName: "A4 examples",
      publicKey: key.publicKey,
      code,
      files: [],
      signedAt: new Date(),
      sign: key.sign,
    });
    const out = join(OUT, `${card.id}-${card.version}.a4plugin`);
    await writeFile(out, bytes);
    process.stdout.write(`Wrote ${out} (${bytes.length.toLocaleString("en-US")} bytes)\n`);
  }
}

await main();
