import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  external: ["@aws-sdk/client-dynamodb", "@aws-sdk/lib-dynamodb", "@patternmesh/core"],
});
