import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";

const execFileAsync = promisify(execFile);

const helperPath = resolve(
  import.meta.dirname,
  "../../packages/conformance/src/linux-pidfd-quiesce.py",
);
const fixturePath = resolve(import.meta.dirname, "linux-pidfd-helper-fixture.py");

describe("Linux stable pidfd quiescence helper", () => {
  test("executes the privileged control flow against identity-stable fakes", async () => {
    const result = await execFileAsync(
      process.platform === "win32" ? "python" : "python3",
      [fixturePath, helperPath],
      { env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } },
    );
    expect(result.stdout).toBe('{"tests":8}');
    expect(result.stderr).toBe("");
  });

  test("binds all four UID arms and signals only identity-stable pidfds", async () => {
    const source = await readFile(helperPath, "utf8");
    expect(source.startsWith("#!/usr/bin/python3\n")).toBe(true);
    expect(source).toContain('fields[0] != "Uid:"');
    expect(source).toContain("values = fields[1:]");
    expect(source).toContain("if uid in process_uids(pid)");
    expect(source).toContain("pidfd = os.pidfd_open(pid, 0)");
    expect(source).toContain("observed = process_uids(pid)");
    expect(source).toContain("if uid not in observed");
    expect(source).toContain("signal.pidfd_send_signal(pidfd, signal.SIGKILL)");
    expect(source).toContain("except ProcessLookupError:");
    expect(source).not.toContain("os.kill(");
    expect(source).not.toMatch(/\bkill\s*\(/);
  });

  test("requires root, high canonical UID, bounded cleanup, and repeated absence", async () => {
    const source = await readFile(helperPath, "utf8");
    for (const relation of [
      "MINIMUM_UID = 1_000_000",
      "MAXIMUM_UID = 2_147_483_646",
      'value != "0" and value.startswith("0")',
      "process_uids(os.getpid()) != (0, 0, 0, 0)",
      'hasattr(os, "pidfd_open")',
      'hasattr(signal, "pidfd_send_signal")',
      "deadline = time.monotonic() + QUIESCENCE_SECONDS",
      "require_before(deadline)",
      "if empty_scans == 2",
      "signal.alarm(QUIESCENCE_SECONDS + 1)",
      "if uid_processes(uid, time.monotonic() + 0.1):",
      "sys.stdout.write('{\"ok\":true}')",
    ])
      expect(source).toContain(relation);
  });
});
