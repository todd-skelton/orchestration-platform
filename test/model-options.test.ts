import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

const cli = fileURLToPath(new URL("../scripts/model-options.mjs", import.meta.url));
function invoke(...args: string[]) {
  return JSON.parse(
    execFileSync(process.execPath, [cli, ...args], {
      encoding: "utf8",
      windowsHide: true,
      stdio: "pipe",
    }),
  );
}

test("Astra is selectable for tasks and orchestration without claiming resolved identity", () => {
  for (const purpose of ["task", "orchestration"]) {
    const models: { selector: string }[] = invoke("list", purpose);
    assert.ok(models.some((model) => model.selector === "gpt-6-astra"));
    for (const effort of ["low", "medium", "high", "xhigh", "max"]) {
      assert.deepEqual(invoke("select", purpose, "gpt-6-astra", effort), {
        provider: "openai",
        harness: "codex",
        modelSelector: "gpt-6-astra",
        effort,
        purpose,
        identityStatus: "selector-only",
      });
    }
  }
});

test("selection rejects aliases, unsupported efforts and unsupported purposes", () => {
  for (const selector of ["astra", "gpt-6", "GPT-6-ASTRA", "gpt-6-astra-future"]) {
    assert.throws(() => invoke("select", "task", selector, "high"), /not selectable/);
  }
  for (const effort of ["none", "minimal", "ultra", "HIGH"]) {
    assert.throws(() => invoke("select", "task", "gpt-6-astra", effort), /Unsupported effort/);
  }
  assert.throws(() => invoke("select", "orchestration", "gpt-5.6-luna", "high"), /not selectable/);
  assert.throws(
    () => invoke("select", "unknown", "gpt-6-astra", "high"),
    /Unknown selection purpose/,
  );
  assert.throws(() => invoke("select", "task", "gpt-6-astra"), /Usage/);
  assert.throws(() => invoke("list", "task", "extra"), /Usage/);
});

test("incumbent Sol remains selectable independently of Astra", () => {
  assert.equal(
    invoke("select", "orchestration", "gpt-5.6-sol", "high").modelSelector,
    "gpt-5.6-sol",
  );
});
