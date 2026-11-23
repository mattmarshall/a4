import { bindings, defineConfig, defineWorker } from "cf/config";

/**
 * A4 is served from a single Cloudflare Worker (vinext's fetch handler) at
 * https://a4.marsh.build. `marsh.build` must be a zone on the deploying
 * Cloudflare account; the custom domain (DNS record + certificate) is
 * created on deploy.
 */
export default defineConfig({
  worker: defineWorker({
    name: "a4",
    entrypoint: "vinext/server/fetch-handler",
    compatibilityDate: "2026-11-23",
    compatibilityFlags: ["nodejs_compat"],
    domains: ["a4.marsh.build"],
    assets: {
      htmlHandling: "none",
      notFoundHandling: "none",
      runWorkerFirst: ["/*", "!/_next/static/*", "!/*/_next/static/*"],
    },
    env: {
      ASSETS: bindings.assets(),
    },
  }),
});
