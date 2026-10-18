import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/verify-entry.ts", "src/cli.ts"],
  format: ["esm"],
  dts: { entry: ["src/index.ts", "src/verify-entry.ts"] },
  sourcemap: true,
  clean: true,
  target: "es2022",
});
