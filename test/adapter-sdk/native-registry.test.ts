import { spawnSync } from "node:child_process";
import { expect, test } from "vitest";
import { commandHandlerRegistration } from "../../packages/adapter-sdk/src/command-handler.mjs";

test("native pre-build CLI registry imports SDK metadata without loading its runtime", () => {
  const registryUrl = new URL("../../packages/cli/src/registry.mjs", import.meta.url);
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `const { commandRegistry } = await import(${JSON.stringify(registryUrl.href)});
process.stdout.write(JSON.stringify({
  frozen: Object.isFrozen(commandRegistry),
  project: commandRegistry.filter((entry) => entry.family === "project"),
  projectHandlerType: typeof commandRegistry.find((entry) => entry.family === "project").handler,
}));`,
    ],
    { encoding: "utf8", timeout: 10000, env: { ...process.env, NODE_OPTIONS: "" } },
  );
  expect(result.status, result.stderr).toBe(0);
  const { handler, ...metadata } = commandHandlerRegistration;
  expect(typeof handler).toBe("function");
  expect(JSON.parse(result.stdout)).toEqual({
    frozen: true,
    project: [metadata],
    projectHandlerType: "function",
  });
});
