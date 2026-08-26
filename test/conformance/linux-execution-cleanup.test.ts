import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";

const execFileAsync = promisify(execFile);
const helperPath = resolve(
  import.meta.dirname,
  "../../packages/conformance/src/linux-execution-cleanup.py",
);
const fixturePath = resolve(import.meta.dirname, "linux-execution-cleanup-fixture.py");

describe("Linux fd-relative execution cleanup helper", () => {
  test("executes closed partial/created identity and cleanup cases", async () => {
    const result = await execFileAsync(
      process.platform === "win32" ? "python" : "python3",
      [fixturePath, helperPath],
      {
        env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
      },
    );
    expect(result.stdout).toBe('{"tests":8}');
    expect(result.stderr).toBe("");
  });

  test("opens and deletes only fixed names fd-relative beneath retained custody", async () => {
    const source = await readFile(helperPath, "utf8");
    for (const relation of [
      "dir_fd=handles[index - 1]",
      "dir_fd=parent",
      "dir_fd=root",
      "os.unlink(name, dir_fd=root)",
      'for field in ("candidate", "rpcRunner", "runtime")',
      'os.rmdir("scratch"',
      "require_chain(ancestors, request)",
    ])
      expect(source).toContain(relation);
    expect(source).not.toMatch(
      /(?:os\.unlink|os\.rmdir)\(request\[["'](?:root|candidate|rpcRunner|runtime|scratch)/,
    );
  });
});
