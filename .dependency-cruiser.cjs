/**
 * Import boundaries (run by `pnpm lint`). lib/ is split into domain folders,
 * each with a public index.ts, and the layers point one way:
 *
 *   page, content, platform   depend on nothing
 *   analysis                  page (and the generated report proto)
 *   archive                   page, platform, and the store's pure names and types
 *   persist                   page, platform (and the generated event proto)
 *   tensor                    page (and the generated sheet proto)
 *   models                    page, platform, persist, analysis, tensor
 *   render                    page, analysis, tensor
 *   workspace                 persist, archive, page, platform, and model errors
 *
 * Components and pages import a folder only through its index.ts. Tests and
 * testing helpers may reach anywhere. Change a rule in the change that needs
 * it, with a comment saying why.
 *
 * @type {import("dependency-cruiser").IConfiguration}
 */

/** Tests and testing helpers aren't part of a layer. */
const NOT_TESTS = "(\\.test\\.tsx?$|/testing/)";

/** `folder` may import only itself and `allowed` (folder names or path patterns under lib/). */
function layer(folder, allowed, comment) {
  const ok = [folder, ...allowed].map((a) => (a.includes("/") ? a : `${a}/`)).join("|");
  return {
    name: `${folder}-layer`,
    severity: "error",
    comment,
    from: { path: `^lib/${folder}/`, pathNot: NOT_TESTS },
    to: { path: "^lib/", pathNot: `^lib/(${ok})` },
  };
}

module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment: "Import cycles make modules impossible to load, test, or move on their own.",
      from: {},
      to: { circular: true },
    },
    {
      name: "lib-not-ui",
      severity: "error",
      comment: "lib/ is the app's core and runs in Node tests: it must not reach into the UI.",
      from: { path: "^lib/" },
      to: { path: "^(components|app)/" },
    },
    {
      name: "lib-no-react",
      severity: "error",
      comment: "lib/ stays framework-free; React lives in components/ and app/.",
      from: { path: "^lib/" },
      to: {
        dependencyTypes: ["npm", "npm-dev", "npm-peer"],
        path: "node_modules/(react|react-dom|react-server-dom-webpack)/",
      },
    },
    {
      name: "lib-no-alias",
      severity: "error",
      comment: "Node runs lib/ directly and can't resolve the @/ alias: use relative imports.",
      from: { path: "^lib/" },
      to: { dependencyTypes: ["aliased-tsconfig-paths"] },
    },
    {
      name: "ui-through-index",
      severity: "error",
      comment:
        "Components and pages use a lib/ folder through its index.ts, its public API. A dynamic import may load an entry point directly (code splitting, like the model registry).",
      from: { path: "^(components|app)/", pathNot: NOT_TESTS },
      to: { path: "^lib/", pathNot: "^lib/[^/]+/index\\.ts$", dependencyTypesNot: ["dynamic-import"] },
    },
    {
      name: "no-eager-plugins",
      severity: "error",
      comment:
        "Plugin code and the model libraries load on first use: the UI and the models index reach plugins only through the registry, whose imports are dynamic.",
      from: { path: ["^(components|app)/", "^lib/models/index\\.ts$"] },
      to: {
        dependencyTypesNot: ["dynamic-import"],
        path: [
          "^lib/models/fit/adapter\\.ts$",
          "^lib/models/semantic/worker\\.ts$",
          "^lib/models/registry\\.ts$",
          "node_modules/(@anthropic-ai/sdk|@huggingface/transformers|onnxruntime-web)/",
        ],
      },
    },
    layer("page", [], "The page (spec, layout, chars, geometry) is the base every layer shares."),
    layer("content", [], "Built-in page text: plain strings."),
    layer("platform", [], "The runtime ports: everything else gets the browser through them."),
    layer("analysis", ["page", "gen"], "The analysis runs anywhere (a CI check, a server): page geometry only."),
    layer(
      "archive",
      ["page", "platform", "persist/store/(names|types)\\.ts$"],
      "Archives read and write page text; only the store's pure name rules and types, so the core stays DOM-free.",
    ),
    layer(
      "persist",
      ["page", "platform", "gen"],
      "Storage holds page text; it doesn't know models, rendering, or the UI.",
    ),
    layer("tensor", ["page", "gen"], "The grid codec is the page in tensor form."),
    layer(
      "models",
      ["page", "platform", "persist", "analysis", "tensor", "gen"],
      "Models read pages: the analysis's line classes (semantic units), the store's revisions (consent), and the grid codec.",
    ),
    layer(
      "render",
      ["page", "analysis", "tensor"],
      "The sheet paints a page and its analysis; it doesn't store or run models.",
    ),
    layer(
      "workspace",
      ["persist", "archive", "page", "platform", "models/errors\\.ts$"],
      "The workspace coordinates storage; it knows model errors only to describe them.",
    ),
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    // Packages stay in the graph (so the rules can see them) but aren't cruised.
    exclude: { path: "^(dist|\\.next|\\.vinext|\\.cloudflare)/" },
    // Type-only imports count: a boundary is about what a module knows, not only what it loads.
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
      extensions: [".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".d.ts"],
    },
  },
};
