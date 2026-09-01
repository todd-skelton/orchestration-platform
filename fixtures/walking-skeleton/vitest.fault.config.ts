import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globalSetup: [],
    include: ["fixtures/walking-skeleton/test/final-cycle-fault-child.test.ts"],
    maxWorkers: 1,
    passWithNoTests: false,
    pool: "forks",
    sequence: { concurrent: false },
  },
});
