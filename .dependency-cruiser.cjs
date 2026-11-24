/**
 * Import boundaries (run by `pnpm lint`). The rules describe the target
 * architecture against today's folders; refactor-lib-layout rewrites them for
 * the new layout. Change a rule in the change that needs it, with a comment
 * saying why.
 *
 * @type {import("dependency-cruiser").IConfiguration}
 */
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
      name: "ui-no-eager-plugins",
      severity: "error",
      comment:
        "Plugin code and the model libraries load on first use. UI code reaches plugins through the registry, whose dynamic imports are allowed.",
      from: { path: "^(components|app)/" },
      to: {
        dependencyTypesNot: ["dynamic-import"],
        path: [
          "^lib/models/fit/adapter\\.ts$",
          "^lib/models/semantic/worker\\.ts$",
          "node_modules/(@anthropic-ai/sdk|@huggingface/transformers|onnxruntime-web)/",
        ],
      },
    },
    {
      name: "storage-not-models-or-paper",
      severity: "error",
      comment: "Storage, autosave, and folders hold page text; they must not depend on models or rendering.",
      from: { path: "^lib/(store|autosave|folder)/" },
      to: { path: "^lib/(models|paper)/" },
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
