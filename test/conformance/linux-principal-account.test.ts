import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";

const execFileAsync = promisify(execFile);
const helperPath = resolve(
  import.meta.dirname,
  "../../packages/conformance/src/linux-principal-account.py",
);
const fixturePath = resolve(import.meta.dirname, "linux-principal-account-fixture.py");

describe("Linux transient user and private-group helper", () => {
  test("executes account authority against a hostile fake NSS and command boundary", async () => {
    const result = await execFileAsync(
      process.platform === "win32" ? "python" : "python3",
      [fixturePath, helperPath],
      { env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } },
    );
    expect(result.stdout).toBe('{"tests":10}');
    expect(result.stderr).toBe("");
  });

  test("uses only closed absolute mutations with pre-registered reversal", async () => {
    const source = await readFile(helperPath, "utf8");
    for (const relation of [
      'GROUPADD = "/usr/sbin/groupadd"',
      'GROUPDEL = "/usr/sbin/groupdel"',
      'NOLOGIN = "/usr/sbin/nologin"',
      'USERADD = "/usr/sbin/useradd"',
      'USERDEL = "/usr/sbin/userdel"',
      "except BaseException:",
      "remove_expected(name, uid, gid)",
      "command([USERDEL, name])",
      "command([GROUPDEL, name])",
      "sys.stdout.write('{\"ok\":true}')",
    ])
      expect(source).toContain(relation);
    expect(source).not.toContain("shell=True");
    expect(source).not.toMatch(/\b(?:os\.system|os\.popen)\b/);
  });

  test("binds dual NSS namespaces and every process UID/GID arm", async () => {
    const source = await readFile(helperPath, "utf8");
    for (const relation of [
      '"groupById": database_lookup(grp.getgrgid, gid)',
      '"groupByName": database_lookup(grp.getgrnam, name)',
      '"userById": database_lookup(pwd.getpwuid, uid)',
      '"userByName": database_lookup(pwd.getpwnam, name)',
      'line.startswith("Uid:") or line.startswith("Gid:")',
      'set(observed) != {"Uid:", "Gid:"}',
      "if uid in uids or gid in gids",
      "tuple(sorted(set(os.getgrouplist(name, gid)))) != (gid,)",
      "primary_members != (name,)",
    ])
      expect(source).toContain(relation);
  });
});
