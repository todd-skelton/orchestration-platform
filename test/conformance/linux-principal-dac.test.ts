import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";

const execFileAsync = promisify(execFile);
const helperPath = resolve(
  import.meta.dirname,
  "../../packages/conformance/src/linux-principal-dac.py",
);
const fixturePath = resolve(import.meta.dirname, "linux-principal-dac-fixture.py");

describe("Linux exact private-group DAC helper", () => {
  test("executes exact profile transitions and rollback through file-handle fakes", async () => {
    const result = await execFileAsync(
      process.platform === "win32" ? "python" : "python3",
      [fixturePath, helperPath],
      { env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } },
    );
    expect(result.stdout).toBe('{"tests":14}');
    expect(result.stderr).toBe("");
  });

  test("uses only no-follow handles and fd-relative fixed child names", async () => {
    const source = await readFile(helperPath, "utf8");
    for (const relation of [
      'ENTRY_NAMES = ("candidate.mjs", "node", "rpc-runner.mjs", "scratch")',
      "os.O_NOFOLLOW | os.O_CLOEXEC",
      "dir_fd=parent",
      "dir_fd=root",
      "os.fwalk(",
      "identity(os.fstat(handle)",
      "os.fchown(handle",
      "os.fchmod(handle",
      "shutil.rmtree.avoids_symlink_attacks",
    ])
      expect(source).toContain(relation);
    expect(source).not.toMatch(/\b(?:os\.chown|os\.chmod)\s*\(/);
  });

  test("revokes parent search before restoring root, children, and scratch", async () => {
    const source = await readFile(helperPath, "utf8");
    expect(source).toContain(
      'for field in ("candidate", "rpcRunner", "runtime", "scratch", "root", "parent")',
    );
    expect(source).toContain(
      'for field in ("parent", "root", "candidate", "rpcRunner", "runtime")',
    );
    expect(source).toContain(
      'for field in ("root", "candidate", "rpcRunner", "runtime", "scratch")',
    );
    expect(source.indexOf("restore_all(handles, originals)")).toBeLessThan(
      source.indexOf('shutil.rmtree("scratch", dir_fd=handles["root"])'),
    );
    expect(source).toContain("sys.stdout.write('{\"ok\":true}')");
  });
});
