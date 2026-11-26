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
          "^lib/models/plugins/fit/adapter\\.ts$",
          "^lib/models/plugins/semantic/worker\\.ts$",
          "^lib/models/registry\\.ts$",
          "node_modules/(@anthropic-ai/sdk|@huggingface/transformers|onnxruntime-web)/",
        ],
      },
    },
    {
      name: "ui-no-plugin-clients",
      severity: "error",
      comment:
        "Only the host reaches a plugin. UI code can't import the manifest, a plugin's code, the client or transport that make raw clients, or consent internals, not even dynamically; it uses the host from lib/models/registry.ts.",
      from: { path: "^(components|app)/" },
      to: { path: ["^lib/models/(manifest|client|worker-transport|consent)\\.ts$", "^lib/models/plugins/"] },
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
      ["persist", "archive", "page", "platform", "desk", "models/errors\\.ts$"],
      "The workspace coordinates storage; it knows model errors only to describe them, and seals and lists letters through the desk.",
    ),
    layer(
      "share",
      ["page", "gen", "tensor", "platform", "desk/letters\\.ts$"],
      "Share links carry a page in a URL fragment: the page, its record, and a letter's seal, with no DOM or Node API.",
    ),
    layer(
      "desk",
      ["page", "analysis", "persist", "platform", "gen", "tensor"],
      "The headless desk judges pages and lints context files without a browser: the page, the analysis, and the folder walk.",
    ),
    {
      name: "cli-copy-only",
      severity: "error",
      comment:
        "The a4 command shares the app's English copy (verdict labels, finding titles, the desk's records) and nothing else from the UI.",
      from: { path: "^cli/", pathNot: NOT_TESTS },
      to: { path: "^components/", pathNot: "^components/(analysis|desk|plugin|share)-copy\\.ts$" },
    },
    {
      name: "cli-through-index",
      severity: "error",
      comment:
        "The a4 command uses lib/ through each folder's index, plus the Node folder adapter it hands the desk, the desk modules the app's first load leaves out (lint, the mailroom, the X-ray), the plugin package checks, and the served library's Node store and request handler.",
      from: { path: "^cli/", pathNot: NOT_TESTS },
      to: {
        path: "^lib/",
        pathNot: [
          "^lib/[^/]+/index\\.ts$",
          "^lib/persist/folder/fs-node\\.ts$",
          "^lib/desk/lint\\.ts$",
          "^lib/desk/mailroom\\.ts$",
          "^lib/desk/xray\\.ts$",
          "^lib/models/package\\.ts$",
          "^lib/models/publishers\\.ts$",
          "^lib/persist/store/node-handle\\.ts$",
          "^lib/persist/store/serve\\.ts$",
        ],
      },
    },
    {
      name: "desk-no-runtime",
      severity: "error",
      comment:
        "The desk runs anywhere the core runs (a CLI, a server, an MCP tool): callers hand it a FolderFs, so it imports no Node built-ins.",
      from: { path: "^lib/desk/", pathNot: NOT_TESTS },
      to: { dependencyTypes: ["core"] },
    },
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
