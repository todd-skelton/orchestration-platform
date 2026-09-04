import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { readModelOptions, runModelOptions, selectModelOption } from "../model-options.mjs";

test("Astra can be selected for tasks and orchestration without claiming resolved identity", async () => {
  const models = await readModelOptions();
  for (const purpose of ["task", "orchestration"]) {
    assert.ok(
      (await runModelOptions(["list", purpose])).some((model) => model.selector === "gpt-6-astra"),
    );
    for (const effort of ["low", "medium", "high", "xhigh", "max"]) {
      assert.deepEqual(selectModelOption(models, purpose, "gpt-6-astra", effort), {
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

test("selection rejects aliases, unsupported efforts, and unsupported purposes", async () => {
  const models = await readModelOptions();
  for (const selector of ["astra", "gpt-6", "GPT-6-ASTRA", "gpt-6-astra-future"]) {
    assert.throws(() => selectModelOption(models, "task", selector, "high"), /not selectable/);
  }
  for (const effort of ["none", "minimal", "ultra", "HIGH"]) {
    assert.throws(
      () => selectModelOption(models, "task", "gpt-6-astra", effort),
      /Unsupported effort/,
    );
  }
  assert.throws(
    () => selectModelOption(models, "orchestration", "gpt-5.6-luna", "high"),
    /not selectable/,
  );
  assert.throws(
    () => selectModelOption(models, "unknown", "gpt-6-astra", "high"),
    /Unknown selection purpose/,
  );
  await assert.rejects(runModelOptions(["select", "task", "gpt-6-astra"]), /Usage/);
});

test("operator command emits an Astra choice and preserves incumbent selection", async () => {
  const cli = fileURLToPath(new URL("../model-options.mjs", import.meta.url));
  const selected = JSON.parse(
    execFileSync(process.execPath, [cli, "select", "orchestration", "gpt-6-astra", "high"], {
      encoding: "utf8",
      windowsHide: true,
    }),
  );
  assert.equal(selected.modelSelector, "gpt-6-astra");
  assert.equal(selected.identityStatus, "selector-only");
  assert.equal(
    (await runModelOptions(["select", "orchestration", "gpt-5.6-sol", "high"])).modelSelector,
    "gpt-5.6-sol",
  );
});
