import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "test/**", "dist/**"],
      thresholds: {
        lines: 75,
        branches: 67,
        functions: 75,
        statements: 75,
      },
    },
  },
});
