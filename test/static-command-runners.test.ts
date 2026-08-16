import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const root = resolve(import.meta.dirname, "..");

function run(script: string, argv: string[]) {
  return spawnSync(process.execPath, [resolve(root, script), ...argv], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  });
}

describe("static placeholder runners", () => {
  test("public CLI resolves a declared command to its owning issue", () => {
    const result = run("packages/cli/bin/orchestrate.mjs", [
      "--output",
      "json",
      "session",
      "handoff",
      "--predecessor",
      "a.json",
      "--successor",
      "b.json",
    ]);
    expect(result.status).toBe(5);
    expect(result.stderr).toContain('"code":"CAPABILITY_NOT_IMPLEMENTED"');
    expect(result.stderr).toContain('"owner":"ISS-007"');
  });

  test("bootstrap abort is declared with no inferred defaults", () => {
    const result = run("bootstrap/bin/orchestration-bootstrap.mjs", [
      "abort",
      "--input",
      "install.json",
      "--output",
      "abort.json",
    ]);
    expect(result.status).toBe(5);
    expect(result.stderr).toContain('"owner":"ISS-020"');
  });

  test("host-custody service install is predeclared", () => {
    const result = run("packages/host-custody/bin/orchestration-host-custody-bootstrap.mjs", [
      "service-install",
      "--plan",
      "plan.json",
      "--plan-id",
      "abc",
      "--output",
      "receipt.json",
    ]);
    expect(result.status).toBe(5);
    expect(result.stderr).toContain('"owner":"ISS-038"');
  });

  test.each([
    ["missing", ["abort", "--input", "install.json"]],
    ["duplicate", ["abort", "--input", "a", "--input", "b", "--output", "c"]],
    ["extra", ["abort", "--input", "a", "--output", "b", "--force"]],
    ["positional", ["abort", "a", "b"]],
    ["undeclared", ["cancel", "--input", "a", "--output", "b"]],
  ])("refuses %s bootstrap arguments before placeholder dispatch", (_name, argv) => {
    const result = run("bootstrap/bin/orchestration-bootstrap.mjs", argv);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('"outcome":"invalid-input"');
    expect(result.stderr).not.toContain("CAPABILITY_NOT_IMPLEMENTED");
  });
});
