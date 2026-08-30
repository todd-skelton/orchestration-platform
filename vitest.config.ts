import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    globalSetup: ["./scripts/test/windows-reparse-fact-global-setup.mjs"],
    environment: "node",
    passWithNoTests: false,
    sequence: { concurrent: false },
  },
});
