import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    passWithNoTests: false,
    sequence: { concurrent: false },
    // Real-Git fixtures routinely take 5 to 6 seconds on the hosted Windows runner.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
