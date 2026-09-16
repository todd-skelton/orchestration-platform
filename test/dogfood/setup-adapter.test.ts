import { execFile } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, it } from "vitest";
import {
  gitSetupAdapter,
  SetupOutputSanitizer,
  type SetupAdapterOptions,
} from "../../scripts/dogfood/setup-adapter.mjs";
import { setupStep, type SetupConfig, type InstallResult } from "../../scripts/dogfood/setup.mjs";

const run = promisify(execFile);
const roots: string[] = [];

async function git(cwd: string, args: string[]) {
  return (
    await run("git", args, {
      cwd,
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
    })
  ).stdout.trim();
}

async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), "setup-git-fixture-"));
  roots.push(root);
  const repository = resolve(root, "portable repository");
  const controller = resolve(root, "stable controller");
  const state = resolve(root, "external state");
  await mkdir(repository);
  await git(repository, ["init", "--quiet"]);
  await git(repository, ["branch", "-M", "main"]);
  await git(repository, ["config", "core.autocrlf", "false"]);
  await writeFile(resolve(repository, ".gitignore"), "node_modules/\n");
  await writeFile(resolve(repository, "fixture.txt"), "portable fixture\n");
  await git(repository, ["add", ".gitignore", "fixture.txt"]);
  await git(repository, [
    "-c",
    "user.name=Synthetic Fixture",
    "-c",
    "user.email=fixture@example.test",
    "commit",
    "--quiet",
    "-m",
    "stable pilot",
  ]);
  const pilotRevision = await git(repository, ["rev-parse", "HEAD"]);
  await git(repository, [
    "-c",
    "user.name=Synthetic Fixture",
    "-c",
    "user.email=fixture@example.test",
    "commit",
    "--quiet",
    "--allow-empty",
    "-m",
    "tree-equivalent base",
  ]);
  const base = await git(repository, ["rev-parse", "HEAD"]);
  await git(repository, ["worktree", "add", "--quiet", "--detach", controller, pilotRevision]);
  await mkdir(state);

  const config: SetupConfig = {
    controller: "synthetic-external-controller",
    run: "synthetic-native-setup",
    issue: "fixture-333",
    repository: "fixture/repository",
    repositoryRoot: repository,
    controllerRoot: controller,
    controllerRevision: pilotRevision,
    pilotRevision: base,
    base,
    baseBranch: "main",
    sourceBranch: "synthetic/iss-075",
    pilotWorktree: resolve(root, "pilot ü"),
    sourceWorktree: resolve(root, "source space"),
    reviewWorktree: resolve(root, "review worktree"),
    stateDirectory: state,
  };
  let installs = 0;
  let installOutcome: "succeeded" | "unknown" = "succeeded";
  const adapter = gitSetupAdapter({
    async install(_launcher, args, cwd) {
      installs += 1;
      expect(args).toEqual(["install", "--offline", "--frozen-lockfile", "--ignore-scripts"]);
      await mkdir(resolve(cwd, "node_modules"), { recursive: true });
      await writeFile(resolve(cwd, "node_modules/.modules.yaml"), "fixture: true\n");
      return installOutcome;
    },
  });
  return {
    root,
    repository,
    controller,
    config,
    adapter,
    installs: () => installs,
    setInstallOutcome(outcome: "succeeded" | "unknown") {
      installOutcome = outcome;
    },
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("prepares three real portable Git worktrees and resumes without duplicate setup", async () => {
  const current = await fixture();

  expect(
    await setupStep(current.config, current.adapter, current.config.controllerRoot),
  ).toMatchObject({ status: "ready", phase: "complete" });
  expect(await git(current.config.pilotWorktree, ["rev-parse", "HEAD"])).toBe(
    current.config.pilotRevision,
  );
  expect(await git(current.config.sourceWorktree, ["rev-parse", "HEAD"])).toBe(current.config.base);
  expect(await git(current.config.sourceWorktree, ["branch", "--show-current"])).toBe(
    current.config.sourceBranch,
  );
  expect(await git(current.config.reviewWorktree, ["branch", "--show-current"])).toBe("");
  expect(current.installs()).toBe(3);

  expect(
    await setupStep(current.config, current.adapter, current.config.controllerRoot),
  ).toMatchObject({ status: "ready", phase: "complete" });
  expect(current.installs()).toBe(3);
  expect(
    JSON.parse(
      await readFile(resolve(current.config.stateDirectory, "dependency-review.json"), "utf8"),
    ),
  ).toMatchObject({
    role: "review",
    head: current.config.base,
    offline: true,
    frozenLockfile: true,
    ignoreScripts: true,
    status: "complete",
  });

  await rm(resolve(current.config.pilotWorktree, "node_modules/.modules.yaml"));
  await expect(
    setupStep(current.config, current.adapter, current.config.controllerRoot),
  ).rejects.toMatchObject({ reason: "dependency-state-drift:pilot" });
  expect(current.installs()).toBe(3);
}, 30_000);

it("keeps a marker-then-unknown install uncertain without repeating it on resume", async () => {
  const current = await fixture();
  current.setInstallOutcome("unknown");

  await expect(
    setupStep(current.config, current.adapter, current.config.controllerRoot),
  ).resolves.toMatchObject({
    status: "incomplete",
    phase: "dependencies",
    reason: "dependency-install-unknown",
  });
  expect(current.installs()).toBe(1);
  await expect(
    access(resolve(current.config.pilotWorktree, "node_modules/.modules.yaml")),
  ).resolves.toBeUndefined();
  await expect(
    access(resolve(current.config.stateDirectory, "dependency-pilot.json")),
  ).rejects.toMatchObject({ code: "ENOENT" });

  current.setInstallOutcome("succeeded");
  await expect(
    setupStep(current.config, current.adapter, current.config.controllerRoot),
  ).resolves.toMatchObject({
    status: "incomplete",
    phase: "dependencies",
    reason: "dependency-install-unknown",
  });
  expect(current.installs()).toBe(1);
  await expect(
    access(resolve(current.config.stateDirectory, "dependency-pilot.json")),
  ).rejects.toMatchObject({ code: "ENOENT" });
}, 30_000);

it("rejects path and branch collisions before creating any selected worktree", async () => {
  const pathCollision = await fixture();
  await mkdir(pathCollision.config.sourceWorktree);
  await writeFile(resolve(pathCollision.config.sourceWorktree, "unrelated.txt"), "preserve\n");
  await expect(
    setupStep(pathCollision.config, pathCollision.adapter, pathCollision.config.controllerRoot),
  ).rejects.toMatchObject({ reason: "worktree-collision:source" });
  await expect(access(pathCollision.config.pilotWorktree)).rejects.toMatchObject({
    code: "ENOENT",
  });
  expect(
    await readFile(resolve(pathCollision.config.sourceWorktree, "unrelated.txt"), "utf8"),
  ).toBe("preserve\n");

  const branchCollision = await fixture();
  await git(branchCollision.repository, ["branch", branchCollision.config.sourceBranch]);
  await expect(
    setupStep(
      branchCollision.config,
      branchCollision.adapter,
      branchCollision.config.controllerRoot,
    ),
  ).rejects.toMatchObject({ reason: "worktree-collision:source" });
  await expect(access(branchCollision.config.pilotWorktree)).rejects.toMatchObject({
    code: "ENOENT",
  });
}, 30_000);

it("keeps a malformed source branch lookup unknown", async () => {
  const current = await fixture();
  current.config.sourceBranch = "malformed..source";

  await expect(current.adapter.observeWorktree(current.config, "source", false)).resolves.toEqual({
    state: "unknown",
  });
});

it("names the preserved holder when an unscoped published branch still collides", async () => {
  const current = await fixture();
  const preserved = resolve(current.root, "preserved source");
  await git(current.repository, ["worktree", "add", "-b", current.config.sourceBranch, preserved]);
  await writeFile(resolve(preserved, "unfinished.txt"), "preserve\n");
  await expect(
    setupStep(current.config, current.adapter, current.controller),
  ).rejects.toMatchObject({
    reason: "worktree-collision:source",
    diagnostics: await realpath(preserved),
  });
  expect(await readFile(resolve(preserved, "unfinished.txt"), "utf8")).toBe("preserve\n");
  expect(await git(preserved, ["branch", "--show-current"])).toBe(current.config.sourceBranch);
  await expect(access(current.config.pilotWorktree)).rejects.toMatchObject({ code: "ENOENT" });
});

it("fails closed on a moving base and on dirty reconciled state", async () => {
  const moving = await fixture();
  await git(moving.repository, [
    "-c",
    "user.name=Synthetic Fixture",
    "-c",
    "user.email=fixture@example.test",
    "commit",
    "--quiet",
    "--allow-empty",
    "-m",
    "moving base",
  ]);
  await expect(
    setupStep(moving.config, moving.adapter, moving.config.controllerRoot),
  ).rejects.toMatchObject({ reason: "setup-head-drift" });
  await expect(access(moving.config.pilotWorktree)).rejects.toMatchObject({ code: "ENOENT" });

  const dirty = await fixture();
  await setupStep(dirty.config, dirty.adapter, dirty.config.controllerRoot);
  await writeFile(resolve(dirty.config.reviewWorktree, "unrelated.txt"), "dirty\n");
  await expect(
    setupStep(dirty.config, dirty.adapter, dirty.config.controllerRoot),
  ).rejects.toMatchObject({ reason: "worktree-collision:review" });
  expect(await readFile(resolve(dirty.config.reviewWorktree, "unrelated.txt"), "utf8")).toBe(
    "dirty\n",
  );
}, 30_000);

it("rejects checkout-contained state before Git or installer mutation", async () => {
  const current = await fixture();
  current.config.stateDirectory = resolve(current.repository, "contained state");
  await mkdir(current.config.stateDirectory);

  await expect(
    setupStep(current.config, current.adapter, current.config.controllerRoot),
  ).rejects.toMatchObject({ reason: "setup-path-inside-existing-checkout" });
  expect(current.installs()).toBe(0);
  await expect(access(current.config.pilotWorktree)).rejects.toMatchObject({ code: "ENOENT" });
});

async function installer(
  current: Awaited<ReturnType<typeof fixture>>,
  source: string,
  options: SetupAdapterOptions = {},
  extraArgs: string[] = [],
) {
  const script = resolve(current.root, "synthetic-installer.cjs");
  // Write bytes to the child's pipe endpoints. Never give the child a log file fd.
  // Node's asynchronous stdio writes are silently lost in the worker sandbox.
  await writeFile(
    script,
    `const output = (fd, bytes) => require('node:fs').writeSync(fd, bytes);\n${source}`,
  );
  return gitSetupAdapter({
    resolveLauncher: async () => ({
      executable: process.execPath,
      prefixArgs: [script, ...extraArgs],
    }),
    ...options,
  });
}

async function evidence(result: InstallResult) {
  const metadata = JSON.parse(await readFile(result.diagnostics, "utf8"));
  return {
    metadata,
    terminal: JSON.parse(await readFile(metadata.terminal, "utf8")),
    stdout: await readFile(metadata.stdout, "utf8"),
    stderr: await readFile(metadata.stderr, "utf8"),
  };
}

it.each([0, 7])(
  "captures real exit %s, both complete streams, full command and trailing bytes",
  async (code) => {
    const current = await fixture();
    await mkdir(current.config.sourceWorktree);
    const adapter = await installer(
      current,
      `
    output(1, 'leading stdout\\n' + 'x'.repeat(200000) + '\\ntrailing stdout');
    output(2, 'leading stderr\\n' + 'y'.repeat(200000) + '\\ntrailing stderr');
    process.exitCode = ${code};
  `,
    );
    const result = (await adapter.installDependencies(current.config, "source")) as InstallResult;
    expect(result.status).toBe(code === 0 ? "succeeded" : "failed");
    const saved = await evidence(result);
    expect(saved.stdout.length).toBe(200031);
    expect(saved.stdout).toBe("leading stdout\n" + "x".repeat(200000) + "\ntrailing stdout");
    expect(saved.stderr).toBe("leading stderr\n" + "y".repeat(200000) + "\ntrailing stderr");
    expect(saved.terminal).toMatchObject({
      role: "source",
      head: current.config.base,
      cwd: current.config.sourceWorktree,
      executable: process.execPath,
      argv: [
        resolve(current.root, "synthetic-installer.cjs"),
        "install",
        "--offline",
        "--frozen-lockfile",
        "--ignore-scripts",
      ],
      exitCode: code,
      signal: null,
      status: result.status,
    });
    expect(saved.terminal.failure).toBeUndefined();
  },
);

it("retains safe spawn and launcher failures without error messages or stacks", async () => {
  const current = await fixture();
  await mkdir(current.config.sourceWorktree);
  const missing = resolve(current.root, "missing-executable");
  const adapter = gitSetupAdapter({
    resolveLauncher: async () => ({ executable: missing, prefixArgs: [] }),
  });
  const result = (await adapter.installDependencies(current.config, "source")) as InstallResult;
  expect(result.status).toBe("unknown");
  expect((await evidence(result)).terminal.failure).toMatchObject({
    stage: "spawn",
    error: { code: "ENOENT", path: missing },
  });

  const unavailable = gitSetupAdapter({
    resolveLauncher: async () => {
      throw Object.assign(new Error("authorization: FAKE_MESSAGE_SECRET"), {
        code: "ENOENT",
        syscall: "open",
        path: "https://user:FAKE_PATH_SECRET@example.test/query?secret=FAKE_QUERY_SECRET",
      });
    },
  });
  const failed = (await unavailable.installDependencies(current.config, "source")) as InstallResult;
  expect(failed.status).toBe("unknown");
  const saved = await evidence(failed);
  expect(saved.terminal.failure).toEqual({
    stage: "launcher",
    error: { code: "ENOENT", syscall: "open", path: "https:[REDACTED]" },
  });
  expect(JSON.stringify(saved)).not.toContain("FAKE_");
  expect(failed.diagnostics).not.toBe(result.diagnostics);
  expect((await evidence(result)).terminal.failure.stage).toBe("spawn");
});

const credentialCases = [
  ...[
    "AuThOrIzAtIoN",
    "PrOxY-AuThOrIzAtIoN",
    "CoOkIe",
    "SeT-CoOkIe",
    "_AuThToKeN",
    "_AuTh",
    "_PaSsWoRd",
  ].map((marker) => ({
    input: `before "${marker}" = 'FAKE_LINE_${"s".repeat(80)}'\r\nafter`,
    expected: 'before "[REDACTED]\r\nafter',
  })),
  {
    input: `before https://user:FAKE_URL_${"s".repeat(80)}@host/path?q=FAKE_QUERY end`,
    expected: "before https:[REDACTED] end",
  },
  { input: "before //user:FAKE_NETWORK@host/path\tend", expected: "before [REDACTED]\tend" },
  { input: "before http://public.example.test/path\nend", expected: "before http:[REDACTED]\nend" },
  {
    input: "    at run (file:///FAKE_FRAME/path.js:1:2)\nend",
    expected: "    at run ([REDACTED]\nend",
  },
  { input: "before _auth=FAKE_EOF", expected: "before [REDACTED]" },
  { input: "before https://user:FAKE_EOF@host", expected: "before https:[REDACTED]" },
  { input: "safe utf8 ü :/ _aut", expected: "safe utf8 ü :/ _aut" },
];

it("sanitizes every byte split independently of child-write coalescing, including EOF and CRLF", () => {
  for (const { input, expected } of credentialCases) {
    const bytes = Buffer.from(input);
    for (let split = 0; split <= bytes.length; split++) {
      const output: number[] = [];
      const sanitizer = new SetupOutputSanitizer((byte) => output.push(byte));
      sanitizer.write(bytes.subarray(0, split));
      sanitizer.write(bytes.subarray(split));
      sanitizer.end();
      expect(Buffer.from(output).toString()).toBe(expected);
    }
  }
  const bytes = Buffer.from([0xff, 0x00, 0xfe, 0x0a]);
  const output: number[] = [];
  const sanitizer = new SetupOutputSanitizer((byte) => output.push(byte));
  for (const byte of bytes) sanitizer.write(Buffer.from([byte]));
  sanitizer.end();
  expect(Buffer.from(output)).toEqual(bytes);
});

it("filters actual child pipes and parent argv across elements before retention", async () => {
  const current = await fixture();
  await mkdir(current.config.sourceWorktree);
  const input = credentialCases.map(({ input }) => input + "\n").join("");
  const expected = credentialCases.map(({ expected }) => expected + "\n").join("");
  const adapter = await installer(
    current,
    `
    const bytes = Buffer.from(${JSON.stringify(input)});
    (async () => {
      for (const byte of bytes) for (const fd of [1, 2])
        output(fd, Buffer.from([byte]));
      process.exitCode = 7;
    })();
  `,
    {},
    ["--safe-argument", "auth", "orization", "FAKE_ARG_SECRET", "\ntrailing-argument"],
  );
  const saved = await evidence(
    (await adapter.installDependencies(current.config, "source")) as InstallResult,
  );
  expect(saved.stdout).toBe(expected);
  expect(saved.stderr).toBe(expected);
  expect(saved.metadata.argv).toEqual([
    resolve(current.root, "synthetic-installer.cjs"),
    "--safe-argument",
    "[REDACTED]",
    "",
    "",
    "\ntrailing-argument",
    "install",
    "--offline",
    "--frozen-lockfile",
    "--ignore-scripts",
  ]);
  expect(JSON.stringify(saved)).not.toContain("FAKE_");
  expect(saved.metadata.cwd).toBe(current.config.sourceWorktree);
});

it("bounds both pumps with slow sinks and unbounded-length suppressed regions", async () => {
  const current = await fixture();
  await mkdir(current.config.sourceWorktree);
  const pending = new Set<number>();
  let writes = 0;
  const adapter = await installer(
    current,
    `
    for (const fd of [1, 2]) {
      output(fd, 'leading\\n' + 'x'.repeat(100000));
      output(fd, ' authorization: FAKE_LONG_' + 's'.repeat(1024 * 1024) + '\\r\\n');
      output(fd, 'https://FAKE_LONG_URL_' + 's'.repeat(1024 * 1024) + ' trailing');
    }
  `,
    {
      async writeInstallOutput(file, bytes) {
        expect(pending.has(file.fd)).toBe(false);
        expect(bytes.length).toBeLessThanOrEqual(32 * 1024);
        pending.add(file.fd);
        writes++;
        await new Promise((done) => setTimeout(done, 1));
        await file.writeFile(bytes);
        pending.delete(file.fd);
      },
    },
  );
  const result = (await adapter.installDependencies(current.config, "source")) as InstallResult;
  expect(result.status).toBe("succeeded");
  const saved = await evidence(result);
  const expected = "leading\n" + "x".repeat(100000) + " [REDACTED]\r\nhttps:[REDACTED] trailing";
  expect(saved.stdout).toBe(expected);
  expect(saved.stderr).toBe(expected);
  expect(writes).toBeGreaterThan(10);
  expect(pending.size).toBe(0);
});

it("kills and reaps the real child on capture failure, closing both files before returning", async () => {
  const current = await fixture();
  await mkdir(current.config.sourceWorktree);
  let childPid = 0;
  const handles: import("node:fs/promises").FileHandle[] = [];
  const adapter = await installer(
    current,
    `
    output(1, process.pid + '\\n' + 'x'.repeat(32768));
    output(2, 'before failure\\n');
    const interval = setInterval(() => output(1, 'more\\n'), 10);
    setTimeout(() => clearInterval(interval), 5000);
  `,
    {
      async writeInstallOutput(file, bytes) {
        handles.push(file);
        if (/^\d+\n/.test(bytes.toString())) {
          childPid = Number(bytes.toString().split("\n")[0]);
          throw Object.assign(new Error("cookie: FAKE_IO_SECRET"), {
            code: "EIO",
            syscall: "write",
          });
        }
        await file.writeFile(bytes);
      },
    },
  );
  const result = (await adapter.installDependencies(current.config, "source")) as InstallResult;
  expect(result.status).toBe("unknown");
  expect(childPid).toBeGreaterThan(0);
  expect(() => process.kill(childPid, 0)).toThrow();
  expect(handles.every((file) => file.fd === -1)).toBe(true);
  const saved = await evidence(result);
  expect(saved.terminal.failure).toEqual({
    stage: "capture",
    error: { code: "EIO", syscall: "write" },
  });
  expect(JSON.stringify(saved)).not.toContain("FAKE_IO_SECRET");
});

it("replays absent installs after a same-root executor upgrade while retaining failed invocations", async () => {
  const current = await fixture();
  const adapter = await installer(
    current,
    `
    const fs = require('node:fs');
    const path = require('node:path');
    if (process.cwd().endsWith('source space') && !fs.existsSync(${JSON.stringify(resolve(current.root, "allow-source"))})) {
      output(1, 'source start\\n'); output(2, 'source synthetic failure\\n'); process.exitCode = 7;
    } else {
      fs.mkdirSync('node_modules', { recursive: true });
      fs.writeFileSync(path.join('node_modules', '.modules.yaml'), 'fixture: true\\n');
    }
  `,
  );
  const failed = await setupStep(current.config, adapter, current.controller);
  expect(failed).toMatchObject({ status: "incomplete", reason: "dependency-install-failed" });
  const oldPlan = await readFile(resolve(current.config.stateDirectory, "setup-plan.json"), "utf8");
  const firstEvidence = await evidence({ status: "failed", diagnostics: failed.diagnostics! });
  expect(firstEvidence.terminal.role).toBe("source");
  await git(current.controller, ["checkout", "--detach", current.config.base]);
  current.config.controllerRevision = current.config.base;
  const failedAgain = await setupStep(current.config, adapter, current.controller);
  expect(failedAgain.reason).toBe("dependency-install-failed");
  expect(failedAgain.diagnostics).not.toBe(failed.diagnostics);
  const names = await readdir(current.config.stateDirectory);
  expect(
    names.filter((name) => /^dependency-pilot-install-.*\.terminal\.json$/.test(name)),
  ).toHaveLength(1);
  expect(
    names.filter((name) => /^dependency-source-install-.*\.terminal\.json$/.test(name)),
  ).toHaveLength(2);
  expect(names.some((name) => name.startsWith("dependency-review"))).toBe(false);
  await writeFile(resolve(current.root, "allow-source"), "explicit resume\n");
  expect(await setupStep(current.config, adapter, current.controller)).toMatchObject({
    status: "ready",
  });
  const completedNames = await readdir(current.config.stateDirectory);
  expect(await setupStep(current.config, adapter, current.controller)).toMatchObject({
    status: "ready",
  });
  expect(await readdir(current.config.stateDirectory)).toEqual(completedNames);
  expect(await readFile(resolve(current.config.stateDirectory, "setup-plan.json"), "utf8")).toBe(
    oldPlan,
  );
  expect(await evidence({ status: "failed", diagnostics: failed.diagnostics! })).toEqual(
    firstEvidence,
  );
  await git(current.controller, ["checkout", "--detach", JSON.parse(oldPlan).controllerRevision]);
  await expect(setupStep(current.config, adapter, current.controller)).rejects.toMatchObject({
    reason: "setup-head-drift",
  });
}, 30_000);

it("retains a real failed install with a marker as unknown on replay without repeating it", async () => {
  const current = await fixture();
  const adapter = await installer(
    current,
    `
    const fs = require('node:fs');
    fs.mkdirSync('node_modules', { recursive: true });
    fs.writeFileSync('node_modules/.modules.yaml', 'fixture: incomplete\\n');
    output(2, 'failed after partial effect\\n');
    process.exitCode = 7;
  `,
  );
  expect(await setupStep(current.config, adapter, current.controller)).toMatchObject({
    reason: "dependency-install-failed",
  });
  const names = await readdir(current.config.stateDirectory);
  const resumed = await setupStep(current.config, adapter, current.controller);
  expect(resumed).toMatchObject({ status: "incomplete", reason: "dependency-install-unknown" });
  expect(JSON.parse(await readFile(resumed.diagnostics!, "utf8"))).toMatchObject({
    role: "pilot",
    status: "failed",
    exitCode: 7,
  });
  expect(await readdir(current.config.stateDirectory)).toEqual(names);
  expect(names).not.toContain("dependency-pilot.json");
  expect(names.some((name) => name.startsWith("dependency-source"))).toBe(false);
});
