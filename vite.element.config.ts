/**
 * The standalone <a4-sheet> build: one ES module with no framework,
 * `dist/element/a4-sheet.js`, exporting `defineA4Sheet` and
 * `A4SheetElement`. Any page can import it and call `defineA4Sheet()` (the
 * /element page shows how). Run it with `pnpm build:element`.
 */

import { defineConfig } from "vite";

export default defineConfig({
  publicDir: false,
  build: {
    outDir: "dist/element",
    emptyOutDir: true,
    target: "es2022",
    sourcemap: true,
    lib: {
      entry: "lib/render/element/a4-sheet.ts",
      formats: ["es"],
      fileName: () => "a4-sheet.js",
    },
  },
});
