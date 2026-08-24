import { mkdtemp, readFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

const helperPath = resolve(
  import.meta.dirname,
  "../../packages/conformance/src/macos-principal-helper.c",
);
const fixturePath = resolve(import.meta.dirname, "macos-principal-helper-fixture.c");
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map(async (root) => await rm(root, { force: true, recursive: true })),
  );
});

describe("macOS narrow principal helper", () => {
  test("keeps exactly EXEC, KILL_UID, and CENSUS_UID modes behind a Darwin build guard", async () => {
    const source = await readFile(helperPath, "utf8");
    expect(source).toContain("#ifdef __APPLE__");
    expect(source).toContain('#error "macos-principal-helper.c is Darwin-only"');
    expect(
      [...source.matchAll(/strcmp\(argv\[1\], "([A-Z_]+)"\)/g)].map((match) => match[1]),
    ).toEqual(["CENSUS_UID", "KILL_UID", "EXEC"]);
    for (const forbidden of ["system(", "popen(", "fork(", "posix_spawn(", "execlp(", "execvp("])
      expect(source).not.toContain(forbidden);
  });

  test("drops groups, GID, then UID irreversibly before exact execve", async () => {
    const source = await readFile(helperPath, "utf8");
    const dropStart = source.indexOf("static void drop_credentials");
    const dropEnd = source.indexOf("static int compare_pid");
    const drop = source.slice(dropStart, dropEnd);
    expect(dropStart).toBeGreaterThan(-1);
    expect(drop.indexOf("setgroups(0, NULL)")).toBeLessThan(drop.indexOf("setgid(gid)"));
    expect(drop.indexOf("setgid(gid)")).toBeLessThan(drop.indexOf("setuid(uid)"));
    expect(drop).toContain("getuid() != uid || geteuid() != uid");
    expect(drop).toContain("getgid() != gid || getegid() != gid");
    expect(drop).toContain("getgroups(0, NULL)");
    expect(drop).toContain("setuid(0) == 0 || errno != EPERM");
    expect(drop).toContain("setgid(0) == 0 || errno != EPERM");
    expect(source).toContain("char *const empty_environment[] = {NULL}");
    expect(source).toContain('child_argv[3] = "--macos-principal"');
    expect(source).toContain("execve(argv[5], child_argv, empty_environment)");
  });

  test("uses credential broadcast and one atomic real/effective UID process snapshot", async () => {
    const source = await readFile(helperPath, "utf8");
    expect(source).toContain("kill(-1, SIGKILL)");
    expect(source).not.toMatch(/kill\([^\-][^,]*,\s*SIG/);
    expect(source).toContain("int mib[3] = {CTL_KERN, KERN_PROC, KERN_PROC_ALL}");
    expect(source).toContain("processes[index].kp_eproc.e_pcred.p_ruid");
    expect(source).toContain("processes[index].kp_eproc.e_ucred.cr_uid");
    expect(source).toContain("qsort(pids, census_count, sizeof(pid_t), compare_pid)");
    expect(source).toContain("census_count >= MAXIMUM_CENSUS");
    expect(source).not.toContain("KERN_PROC_UID");
    expect(source).not.toContain("KERN_PROC_RUID");
  });

  test("pins the burned identity range and canonical numeric parsing", async () => {
    const source = await readFile(helperPath, "utf8");
    expect(source).toContain("#define MINIMUM_ID 60000UL");
    expect(source).toContain("#define MAXIMUM_ID 64999UL");
    expect(source).toContain("text[0] == '0' && text[1] != '\\0'");
    expect(source).toContain('if (uid != gid) fail("identity-pair")');
  });

  test.runIf(process.platform === "darwin")(
    "compiles warning-free as one native helper through exact xcrun clang",
    async () => {
      const root = await mkdtemp(resolve(tmpdir(), "orchestration-macos-helper-"));
      roots.push(root);
      const output = resolve(root, "macos-principal-helper");
      const selected = spawnSync("/usr/bin/xcrun", ["--find", "clang"], {
        encoding: "utf8",
        windowsHide: true,
      });
      expect(selected.status, selected.stderr).toBe(0);
      const clang = selected.stdout.trim();
      expect(clang.startsWith("/")).toBe(true);
      const architecture = process.arch === "arm64" ? "arm64" : "x86_64";
      const compiled = spawnSync(
        clang,
        [
          "-std=c11",
          "-Wall",
          "-Wextra",
          "-Werror",
          "-arch",
          architecture,
          helperPath,
          "-o",
          output,
        ],
        { encoding: "utf8", windowsHide: true },
      );
      expect(compiled.status, compiled.stderr).toBe(0);
      expect(compiled.stdout).toBe("");
      expect(compiled.stderr).toBe("");

      const fixtureOutput = resolve(root, "macos-principal-helper-fixture");
      const fixtureCompiled = spawnSync(
        clang,
        [
          "-std=c11",
          "-Wall",
          "-Wextra",
          "-Werror",
          "-arch",
          architecture,
          fixturePath,
          "-o",
          fixtureOutput,
        ],
        { encoding: "utf8", windowsHide: true },
      );
      expect(fixtureCompiled.status, fixtureCompiled.stderr).toBe(0);
      expect(fixtureCompiled.stdout).toBe("");
      expect(fixtureCompiled.stderr).toBe("");
      const fixture = spawnSync(fixtureOutput, [], { encoding: "utf8", windowsHide: true });
      expect(fixture.status, fixture.stderr).toBe(0);
      expect(fixture.stdout).toBe("macos helper fixture ok\n");
      expect(fixture.stderr).toBe("");
    },
  );

  test("keeps the macOS helper off the package root", async () => {
    const publicSurface = await import("../../packages/conformance/src/index.js");
    expect(publicSurface).not.toHaveProperty("macosPrincipalHelper");
  });
});
