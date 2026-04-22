import { defineConfig } from "vitest/config";

const hasLocalEndpoint = Boolean(process.env.DYNAMODB_ENDPOINT?.trim());

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.ts"],
      exclude: ["test/**", "dist/**"],
      thresholds: {
        lines: hasLocalEndpoint ? 85 : 25,
        branches: hasLocalEndpoint ? 80 : 55,
        functions: hasLocalEndpoint ? 85 : 30,
        statements: hasLocalEndpoint ? 85 : 25,
      },
    },
  },
});
