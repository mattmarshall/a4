import { mkdirSync, writeFileSync } from "node:fs";
import { relative } from "node:path";
import { defineConfig, type Plugin } from "vite";
import vinext from "vinext";
import { cloudflare } from "@cloudflare/vite-plugin";

/**
 * The ONNX runtime's JavaScript references WebAssembly builds the app never
 * loads: the WebGPU-capable ones (asyncify, jsep, jspi). The asyncify file is
 * 26.9 MB, over Cloudflare's 25 MiB asset limit. The app always points the
 * runtime at the plain build it serves itself (see lib/models/plugins/semantic/worker.ts),
 * so drop the others from the output.
 */
function dropUnusedOrtWasm(): Plugin {
  return {
    name: "a4:drop-unused-ort-wasm",
    generateBundle(_options, bundle) {
      for (const [file, output] of Object.entries(bundle)) {
        if (output.type === "asset" && /ort-wasm-simd-threaded\.(asyncify|jsep|jspi)[^/]*\.wasm$/.test(file)) {
          delete bundle[file];
        }
      }
    },
  };
}

/**
 * The bundler treats `window` as a known browser global and folds
 * transformers.js's environment guard,
 *   typeof window !== "undefined" && typeof window.document !== "undefined"
 * into `window.document !== void 0`, which throws in a Web Worker (no
 * `window`). Reading it through `globalThis` keeps the guard intact. Fails the
 * build if the library changes that line, so this can't silently stop working.
 */
function keepWindowGuardInWorkers(): Plugin {
  const guard = 'typeof window !== "undefined" && typeof window.document !== "undefined"';
  return {
    name: "a4:keep-window-guard-in-workers",
    transform(code, id) {
      if (!/@huggingface[\\/]transformers[\\/]dist[\\/]transformers\.web\.js$/.test(id.split("?")[0])) return null;
      if (!code.includes(guard)) {
        this.error(
          "transformers.js no longer contains the expected window guard; review keepWindowGuardInWorkers in vite.config.ts.",
        );
      }
      return {
        code: code.replace(
          guard,
          'typeof globalThis.window !== "undefined" && typeof globalThis.window.document !== "undefined"',
        ),
        map: null,
      };
    },
  };
}

/**
 * Model plugins run only in the browser. lib/models/manifest.ts loads each
 * implementation lazily (`import("./plugins/<id>/connect.ts")`), but a server
 * build still bundles a dynamic import's target, and Semantic repetition's
 * worker brings a 14 MB WebAssembly runtime. In server environments, each
 * plugin's connect.ts resolves to a stub that refuses to connect.
 */
function browserOnlyPlugins(): Plugin {
  const STUB = "\0a4:plugin-connect-stub";
  return {
    name: "a4:browser-only-plugins",
    enforce: "pre",
    resolveId(source) {
      if (this.environment.config.consumer === "client") return null;
      return /^\.\/plugins\/[^/]+\/connect\.ts$/.test(source) ? STUB : null;
    },
    load(id) {
      if (id !== STUB) return null;
      return 'export async function connect() { throw new Error("Model plugins run only in the browser."); }';
    },
  };
}

/** Where recordClientChunks writes, outside the served assets. */
const CLIENT_CHUNKS_REPORT = "dist/client-chunks.json";

/**
 * Records the source modules in each client chunk, so scripts/check-bundle.ts
 * can tell exactly what the first page load contains.
 */
function recordClientChunks(): Plugin {
  return {
    name: "a4:record-client-chunks",
    apply: "build",
    generateBundle(_options, bundle) {
      if (this.environment.name !== "client") return;
      const root = this.environment.config.root;
      const chunks: Record<string, string[]> = {};
      for (const [file, output] of Object.entries(bundle)) {
        if (output.type === "chunk")
          chunks[file] = output.moduleIds.map((id) => (id.startsWith("/") ? relative(root, id) : id));
      }
      mkdirSync("dist", { recursive: true });
      writeFileSync(CLIENT_CHUNKS_REPORT, `${JSON.stringify(chunks, null, 1)}\n`);
    },
  };
}

export default defineConfig({
  worker: {
    // ES module workers can code-split, so the inference library loads only
    // when a model is used, not with the worker.
    format: "es",
    plugins: () => [dropUnusedOrtWasm(), keepWindowGuardInWorkers()],
  },
  plugins: [
    vinext({
      prerender: { routes: "*" },
    }),
    cloudflare({
      viteEnvironment: {
        name: "rsc",
        childEnvironments: ["ssr"],
      },
    }),
    browserOnlyPlugins(),
    dropUnusedOrtWasm(),
    recordClientChunks(),
  ],
});
