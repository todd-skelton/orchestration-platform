import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { defineConfig } from "vitest/config";

const hasConfigSources = existsSync(
  resolve(import.meta.dirname, "packages/config/native/windows-reparse-fact/manifest.json"),
);

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts", "fixtures/*/test/**/*.test.ts"],
    globalSetup: hasConfigSources ? ["./scripts/test/windows-reparse-fact-global-setup.mjs"] : [],
    environment: "node",
    passWithNoTests: false,
    sequence: { concurrent: false },
  },
});
