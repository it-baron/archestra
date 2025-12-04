import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/server.ts"],
  format: "esm",
  dts: true,
  clean: true,
  outDir: "dist",
  skipNodeModulesBundle: true,
});
