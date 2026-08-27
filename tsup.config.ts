import { defineConfig } from "tsup";

export default defineConfig({
  entry: { "ingest-cli": "apps/ingest-cli/src/index.ts" },
  format: ["esm"],
  platform: "node",
  target: "node22",
  outDir: "dist",
  outExtension: () => ({ js: ".js" }),
  clean: true,
  sourcemap: true,
  dts: false,
});
