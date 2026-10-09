import { execFile, spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { createServer, get, type Server } from "node:http";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, it } from "vitest";

// ISS-162: the executor entrypoints that carry the pool status URL and its
// bridge. Local fixtures and command doubles only; no pool, WSL loop or
// credentials.
const exec = promisify(execFile);
const executor = resolve(import.meta.dirname, "../scripts/executor");
const supervise = resolve(import.meta.dirname, "../scripts/dogfood/supervise.mjs");
const bridge = resolve(executor, "pool-bridge.mjs");
const cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});
const listen = (server: Server, host: string) =>
  new Promise<number>((done, reject) => {
    server.once("error", reject);
    server.listen(0, host, () => done((server.address() as { port: number }).port));
  });
const closeServer = (server: Server) => new Promise<void>((done) => server.close(() => done()));
const read = (url: string) =>
  new Promise<{ status: number; body: string }>((done, reject) =>
    get(url, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => (body += chunk));
      response.on("end", () => done({ status: response.statusCode ?? 0, body }));
    }).on("error", reject),
  );
const exited = (child: ChildProcess) =>
  new Promise<{ code: number | null; stderr: string }>((done) => {
    let stderr = "";
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk) => (stderr += chunk));
    child.once("exit", (code) => done({ code, stderr }));
  });

async function until(check: () => Promise<boolean>) {
  const deadline = Date.now() + 8000;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error("fixture did not reach rendezvous");
    await new Promise((done) => setTimeout(done, 20));
  }
}

async function installFixture(path = "source.txt", mutant?: "exclusive" | "descriptor") {
  const root = await mkdtemp(resolve(tmpdir(), "executor-install-"));
  cleanup.push(() => rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }));
  const task = resolve(root, "task");
  const repo = resolve(task, "repo");
  const bin = resolve(task, "tools/node-v24.15.0-linux-x64/bin");
  const fakes = resolve(root, "fakes");
  for (const directory of [
    repo,
    bin,
    fakes,
    resolve(task, "codex-home"),
    resolve(root, "cgroups"),
    resolve(root, "launcher/scripts/executor"),
    resolve(root, "launcher/scripts/dogfood"),
  ])
    await mkdir(directory, { recursive: true });
  await symlink(process.execPath, resolve(bin, "node"));
  await writeFile(
    resolve(task, "codex-home/config.toml"),
    'base_url = "http://10.0.0.1:8317/v1"\n',
  );
  await writeFile(resolve(fakes, "ip"), "#!/bin/sh\necho 'default via 10.0.0.1 dev eth0'\n", {
    mode: 0o700,
  });
  const git = async (...args: string[]) => (await exec("git", ["-C", repo, ...args])).stdout.trim();
  await git("init", "-b", "main");
  await git("config", "user.name", "Fixture");
  await git("config", "user.email", "fixture@example.test");
  await writeFile(resolve(repo, "base.txt"), "base\n");
  await git("add", ".");
  await git("commit", "-m", "base");
  const from = await git("rev-parse", "HEAD");
  await mkdir(resolve(repo, path, ".."), { recursive: true });
  await writeFile(resolve(repo, path), "candidate\n");
  await git("add", ".");
  await git("commit", "-m", "candidate");
  const sha = await git("rev-parse", "HEAD");
  await git("reset", "--hard", from);
  const launcher = resolve(root, "launcher/scripts/executor/run-loop.sh");
  let body = await readFile(resolve(executor, "run-loop.sh"), "utf8");
  if (mutant === "exclusive") body = body.replace("if ! flock -xn 9; then", "if false; then");
  if (mutant === "descriptor") body = body.replaceAll(" 9>&-", "");
  await writeFile(launcher, body);
  await writeFile(
    resolve(root, "launcher/scripts/dogfood/process-ownership.mjs"),
    await readFile(resolve(executor, "../dogfood/process-ownership.mjs")),
  );
  await writeFile(
    resolve(bin, "pnpm"),
    `#!/usr/bin/env bash
set -eu
if [[ "$1" == install ]]; then
  touch '${root}/install-entered'
  if [[ -e '${root}/hold-install' ]]; then
    while [[ ! -e '${root}/release-install' ]]; do sleep 0.02; done
  fi
  [[ ! -e '${root}/fail-install' ]]
  exit $?
fi
run=$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1])).run)' "$3")
printf '%s %s\\n' "$run" "$(git rev-parse HEAD)" >> '${root}/starts'
if [[ -e '${root}/child' ]]; then
  sleep 60 </dev/null >/dev/null 2>&1 &
  echo $! > '${root}/child-pid'
fi
if [[ "$run" == self && ! -e '${root}/offered' ]]; then
  touch '${root}/offered'
  echo '{"status":"upgrade-ready","sha":"${sha}","run":"self"}'
else
  echo "{\\"status\\":\\"idle\\",\\"run\\":\\"$run\\"}"
fi
`,
    { mode: 0o700 },
  );
  const config = async (run: string) => {
    const file = resolve(root, `${run}.json`);
    await writeFile(
      file,
      JSON.stringify({
        schemaVersion: "dogfood-loop/v1",
        run,
        adapter: run === "self" ? "self" : "chase-sets",
        stateRoot: resolve(root, "state"),
      }),
    );
    return file;
  };
  const exists = async (path: string) =>
    stat(resolve(root, path)).then(
      () => true,
      () => false,
    );
  const launch = async (run = "self") => {
    const child = spawn("bash", [launcher, await config(run)], {
      env: {
        ...process.env,
        TASK_ROOT: task,
        PATH: `${fakes}:${process.env.PATH}`,
        ORCHESTRATION_CGROUP_ROOT: resolve(root, "cgroups"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    cleanup.push(() => {
      child.kill();
    });
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    const done = exited(child).then((result) => ({ ...result, stdout }));
    return { child, done };
  };
  return { root, task, from, sha, git, launch, exists };
}

it.skipIf(process.platform !== "linux")(
  "ISS-250 installs green S and re-enters inside one ownership binding",
  async () => {
    const f = await installFixture();
    await f.git("reset", "--hard", f.sha);
    await writeFile(resolve(f.task, "repo/later.txt"), "main moved after admission\n");
    await f.git("add", "later.txt");
    await f.git("commit", "-m", "later main");
    const later = await f.git("rev-parse", "HEAD");
    await f.git("update-ref", "refs/remotes/origin/main", later);
    await f.git("reset", "--hard", f.from);
    const { code, stdout, stderr } = await (await f.launch()).done;
    expect(
      code,
      stderr + stdout + (await readFile(resolve(f.root, "supervisor.log"), "utf8").catch(() => "")),
    ).toBe(0);
    expect(stdout).toContain('"status":"executor-upgraded"');
    expect(stdout).toContain(`"from":"${f.from}","to":"${f.sha}"`);
    expect(await readFile(resolve(f.root, "starts"), "utf8")).toBe(
      `self ${f.from}\nself ${f.sha}\n`,
    );
    expect(await f.exists("task/executor-install.json")).toBe(false);
    expect(await readdir(resolve(f.root, "state/self/process-ownership"))).toHaveLength(1);
    // A later origin/main neither substitutes for S nor defers its installation.
    expect(await f.git("rev-parse", "HEAD")).toBe(f.sha);
    expect(await f.git("rev-parse", "refs/remotes/origin/main")).toBe(later);
  },
);

it.skipIf(process.platform !== "linux")(
  "ISS-250 a peer's shared lock defers installation and restarts current head",
  async () => {
    const f = await installFixture();
    const holder = spawn(
      "bash",
      [
        "-c",
        'exec 8>"$1"; flock -s 8; echo ready; read -r release',
        "fixture",
        resolve(f.task, "executor.lock"),
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    const held = exited(holder);
    cleanup.push(() => {
      holder.kill();
    });
    await new Promise((done) => holder.stdout.once("data", done));
    const result = await (await f.launch()).done;
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(`upgrade-deferred:${f.sha}:executor-busy`);
    expect(await f.git("rev-parse", "HEAD")).toBe(f.from);
    expect(await readFile(resolve(f.root, "starts"), "utf8")).toBe(
      `self ${f.from}\nself ${f.from}\n`,
    );
    holder.stdin.end("release\n");
    await held;
  },
);

it.skipIf(process.platform !== "linux").each([false, true])(
  "ISS-250 racing M2 start waits for exclusive installation (lock mutant=%s)",
  async (mutant) => {
    const f = await installFixture("source.txt", mutant ? "exclusive" : undefined);
    await writeFile(resolve(f.root, "hold-install"), "");
    const self = await f.launch();
    await until(() => f.exists("install-entered"));
    const m2 = await f.launch("m2");
    // Wait for its binding: enrollment precedes the shared-lock acquisition.
    await until(
      async () =>
        (await readdir(resolve(f.root, "state/m2/process-ownership")).catch(() => [])).length > 0,
    );
    let m2Exited = false;
    void m2.done.then(() => {
      m2Exited = true;
    });
    if (mutant) await until(async () => m2Exited);
    else await new Promise((done) => setTimeout(done, 300));
    expect(m2Exited).toBe(mutant);
    expect(await readFile(resolve(f.root, "starts"), "utf8")).toBe(`self ${f.from}\n`);
    await writeFile(resolve(f.root, "release-install"), "");
    expect((await self.done).code).toBe(0);
    const outcome = await m2.done;
    if (mutant) {
      expect(outcome.stdout).toContain('"status":"executor-install-failed"');
    } else {
      expect(outcome.code).toBe(0);
      expect(await readFile(resolve(f.root, "starts"), "utf8")).toContain(`m2 ${f.sha}\n`);
    }
  },
);

it
  .skipIf(process.platform !== "linux")
  .each([
    "scripts/executor/a.sh",
    "scripts/dogfood/process-ownership.mjs",
    "package.json",
    "pnpm-lock.yaml",
  ])("ISS-250 restart-only %s refuses before mutation", async (path) => {
  const f = await installFixture(path);
  const result = await (await f.launch()).done;
  expect(result.code).toBe(1);
  expect(result.stdout).toContain('"status":"upgrade-requires-restart"');
  expect(await f.git("rev-parse", "HEAD")).toBe(f.from);
  expect(await f.exists("task/executor-install.json")).toBe(false);
  expect(await f.exists("install-entered")).toBe(false);
});

it.skipIf(process.platform !== "linux").each(["failed", "installing"])(
  "ISS-250 durable %s blocks the next wrapper start",
  async (state) => {
    const f = await installFixture();
    if (state === "failed") {
      await writeFile(resolve(f.root, "fail-install"), "");
      expect((await (await f.launch()).done).code).toBe(1);
      expect(await f.git("rev-parse", "HEAD")).toBe(f.sha);
    } else {
      await writeFile(
        resolve(f.task, "executor-install.json"),
        JSON.stringify({ state, from: f.from, to: f.sha, at: new Date().toISOString() }),
      );
    }
    const saved = await readFile(resolve(f.task, "executor-install.json"), "utf8");
    expect(JSON.parse(saved)).toMatchObject({
      state,
      from: f.from,
      to: f.sha,
      ...(state === "failed" ? { step: "install" } : {}),
    });
    const result = await (await f.launch("m2")).done;
    expect(result.code).toBe(1);
    expect(result.stdout).toContain('"status":"executor-install-failed"');
    expect(await readFile(resolve(f.task, "executor-install.json"), "utf8")).toBe(saved);
    expect(await readFile(resolve(f.root, "starts"), "utf8").catch(() => "")).not.toContain("m2");
  },
);

it.skipIf(process.platform !== "linux").each([false, true])(
  "ISS-250 a surviving child cannot retain fd 9 (closure mutant=%s)",
  async (mutant) => {
    const f = await installFixture("source.txt", mutant ? "descriptor" : undefined);
    await writeFile(resolve(f.root, "child"), "");
    await writeFile(resolve(f.root, "offered"), "");
    expect((await (await f.launch()).done).code).toBe(0);
    const pid = Number(await readFile(resolve(f.root, "child-pid"), "utf8"));
    cleanup.push(() => {
      try {
        process.kill(pid);
      } catch {}
    });
    process.kill(pid, 0);
    const locked = await exec("flock", ["-xn", resolve(f.task, "executor.lock"), "true"]).then(
      () => true,
      () => false,
    );
    expect(locked).toBe(!mutant);
  },
);

it.skipIf(process.platform !== "linux")(
  "ISS-250 a shared-lock timeout reports executor-busy before supervisor start",
  async () => {
    const f = await installFixture();
    // Replace elapsed waiting only; the body supplies the real ten-minute bound.
    await writeFile(
      resolve(f.root, "fakes/flock"),
      `#!/bin/sh
printf '%s\\n' "$*" > '${f.root}/lock-args'
exit 1
`,
      { mode: 0o700 },
    );
    const result = await (await f.launch()).done;
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: "executor-busy",
      run: "self",
      observedAt: expect.any(String),
    });
    expect(await readFile(resolve(f.root, "lock-args"), "utf8")).toBe("-s -w 600 9\n");
    expect(await f.exists("starts")).toBe(false);
  },
);

it.for(["executor-busy", "executor-install-failed", "upgrade-requires-restart"])(
  "ISS-250 attached Windows parent accepts terminal %s",
  async (status, context) => {
    const root = await mkdtemp(resolve(tmpdir(), "wrapper-status-"));
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    const child = resolve(root, "child.mjs");
    await writeFile(
      child,
      `console.log(JSON.stringify({status:${JSON.stringify(status)},run:"self",observedAt:new Date().toISOString()})); process.exitCode=1;`,
    );
    const loss = resolve(root, "loss");
    const harness = await startLoopHarness([
      `$code = Start-AttachedSupervisor -Executable '${process.execPath}' -ArgumentList @('${child}') -LossNoteDirectory '${loss}' -Config '/fixture/loop.json'`,
      'Write-Host "exit=$code"',
    ]);
    if (!harness) return context.skip();
    expect((await harness.run()).stdout).toContain("exit=1");
    expect(await readdir(loss).catch(() => [])).toEqual([]);
  },
);
async function ipv6Loopback() {
  const probe = createServer();
  try {
    await listen(probe, "::1");
    await closeServer(probe);
    return true;
  } catch {
    return false;
  }
}

it("bridges each requested port to the same loopback port only", async (context) => {
  // The bridge listens on the WSL-facing address and forwards to 127.0.0.1 on
  // the same port, so the fixture sits on IPv4 loopback and the bridge on IPv6.
  if (!(await ipv6Loopback())) context.skip();
  const startBridge = async (port: number) => {
    const child = spawn(process.execPath, [bridge, "::1", String(port)], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    cleanup.push(() => {
      child.kill();
    });
    const done = exited(child);
    const banner = await Promise.race([
      new Promise<string>((ok) => child.stdout!.once("data", (chunk) => ok(String(chunk)))),
      done.then(({ code, stderr }) => {
        throw new Error(`bridge exited ${code}: ${stderr}`);
      }),
    ]);
    expect(banner.trim()).toBe(`pool bridge ::1:${port} -> 127.0.0.1:${port}`);
    return child;
  };
  const fixtures = new Map<number, string>();
  for (const identity of ["inference", "status"]) {
    const fixture = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ identity }));
    });
    const port = await listen(fixture, "127.0.0.1");
    cleanup.push(() => closeServer(fixture));
    fixtures.set(port, identity);
    await startBridge(port);
  }
  for (const [port, identity] of fixtures) {
    const response = await read(`http://[::1]:${port}/api/status`);
    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ identity });
  }
  for (const args of [[], ["::1", "0"], ["::1", "eight"]]) {
    const child = spawn(process.execPath, [bridge, ...args], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const { code, stderr } = await exited(child);
    expect(code).not.toBe(0);
    expect(stderr).toContain(
      "usage: node scripts/executor/pool-bridge.mjs <wsl-host-address> [port]",
    );
  }
});

async function powershell() {
  for (const shell of ["pwsh", "powershell"]) {
    try {
      await exec(
        shell,
        ["-NoProfile", "-NonInteractive", "-Command", "$PSVersionTable.PSVersion.Major"],
        { windowsHide: true },
      );
      return shell;
    } catch {}
  }
  return undefined;
}

// ISS-164: start-loop.ps1 is dot-sourced for its functions. The bridge
// startup is unchanged; the attached parent is exercised against a Node child
// standing in for wsl.exe with the same redirected stdio. The real wsl.exe
// parent path is the Windows incumbent host's own observation.
async function startLoopHarness(body: string[]) {
  const shell = await powershell();
  if (!shell) return undefined;
  const root = await mkdtemp(resolve(tmpdir(), "start-loop-"));
  cleanup.push(() => rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }));
  const script = resolve(executor, "start-loop.ps1");
  await writeFile(resolve(root, "harness.ps1"), [`. '${script}'`, ...body, ""].join("\n"));
  const run = async () => {
    const { stdout, stderr } = await exec(
      shell,
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        resolve(root, "harness.ps1"),
      ],
      { windowsHide: true },
    );
    return { stdout, stderr };
  };
  return { root, run };
}

it.for([
  { flag: "-PauseAfterCurrent", action: "pause", code: 0, launch: false },
  { flag: "-Resume", action: "resume", code: 0, launch: true },
  { flag: "", action: "start", code: 0, launch: true },
  { flag: "-Resume", action: "resume", code: 1, launch: false },
])(
  "launcher preflight $action (exit $code) precedes every bridge and launch",
  async ({ flag, action, code, launch }, context) => {
    const shell = await powershell();
    if (!shell) return context.skip();
    const root = await mkdtemp(resolve(tmpdir(), "pause-launcher-"));
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    const source = await readFile(resolve(executor, "start-loop.ps1"), "utf8");
    const boundary = "$check = [System.Diagnostics.Process]::Start($control)";
    expect(source).toContain(boundary);
    const script = resolve(root, "capture.ps1");
    // Replace external execution only. The real entry constructs argv, branches
    // on preflight failure/pause, and forwards resume into the attached launcher.
    await writeFile(
      script,
      source.replace(
        boundary,
        `
    [pscustomobject]@{event='control'; arguments=@($control.ArgumentList); wslenv=$control.Environment['WSLENV']; shell=$control.UseShellExecute} | ConvertTo-Json -Compress
    $check = [pscustomobject]@{ExitCode=${code}}
    $check | Add-Member -MemberType ScriptMethod -Name WaitForExit -Value { }
    function Start-PoolBridges { param($Bridge) Write-Output '{"event":"bridge"}' }
    function Start-AttachedSupervisor { param($Executable, $ArgumentList, $VerifierWorktree, $LossNoteDirectory, $Config)
      [Console]::WriteLine(([pscustomobject]@{event='launch'; arguments=$ArgumentList; verifier=$VerifierWorktree; loss=$LossNoteDirectory; config=$Config} | ConvertTo-Json -Compress))
      return 0
    }
  `,
      ),
    );
    const config = '/root/config with spaces/loop;$PATH "quoted".json';
    const result = await new Promise<{ code: number | null; stdout: string }>((done, reject) => {
      const child = spawn(
        shell,
        [
          "-NoProfile",
          "-NonInteractive",
          "-File",
          script,
          "-Config",
          config,
          "-VerifierWorktree",
          "C:/verifier space",
          ...(flag ? [flag] : []),
        ],
        { windowsHide: true, env: { ...process.env, LOCALAPPDATA: resolve(root, "local app") } },
      );
      let stdout = "";
      child.stdout.on("data", (data) => (stdout += data));
      child.on("error", reject);
      child.on("close", (code) => done({ code, stdout }));
    });
    expect(result.code).toBe(code);
    const rows = result.stdout
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line));
    expect(rows[0]).toMatchObject({
      event: "control",
      wslenv: "",
      shell: false,
      arguments: [
        "-d",
        "Ubuntu",
        "--exec",
        "/root/orchestration-m1/tools/node-v24.15.0-linux-x64/bin/node",
        "/root/orchestration-m1/repo/scripts/dogfood/control.mjs",
        config,
        action,
      ],
    });
    expect(rows.map((row) => row.event)).toEqual(
      launch ? ["control", "bridge", "launch"] : ["control"],
    );
    if (launch) {
      expect(rows[2]).toMatchObject({
        arguments: [
          "-d",
          "Ubuntu",
          "--",
          "bash",
          "/root/orchestration-m1/repo/scripts/executor/run-loop.sh",
          config,
        ],
        verifier: "C:/verifier space",
        config,
      });
      // pwsh's Join-Path emits the host separator, so both sides are compared
      // with separators normalized rather than against a literal backslash.
      expect(String(rows[2].loss).replaceAll("\\", "/")).toBe(
        resolve(root, "local app", "orchestration-platform", "supervisor-loss").replaceAll(
          "\\",
          "/",
        ),
      );
    }
  },
);

it("starts one bridge per missing port before launching the loop", async (context) => {
  const root = await mkdtemp(resolve(tmpdir(), "start-loop-bridge-"));
  cleanup.push(() => rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }));
  const log = resolve(root, "calls.log");
  // Cmdlet doubles: functions win over cmdlets by name, so the script sees a
  // WSL adapter at 172.16.0.1 with 8317 already listening and 8318 free.
  const harness = await startLoopHarness([
    "function Get-NetIPAddress { @([pscustomobject]@{ InterfaceAlias = 'Ethernet'; IPAddress = '10.0.0.5' }, [pscustomobject]@{ InterfaceAlias = 'vEthernet (WSL (Hyper-V firewall))'; IPAddress = '172.16.0.1' }) }",
    "function Get-NetTCPConnection { param($State, $LocalAddress, $LocalPort, $ErrorAction) if ($State -eq 'Listen' -and $LocalAddress -eq '172.16.0.1' -and $LocalPort -eq 8317) { [pscustomobject]@{ LocalPort = 8317 } } }",
    `function Start-Process { param($FilePath, $ArgumentList, $WindowStyle) Add-Content -LiteralPath '${log}' -Value ('start ' + $FilePath + ' ' + ($ArgumentList -join ' ') + ' ' + $WindowStyle) }`,
    "function Start-Sleep { }",
    `Start-PoolBridges -Bridge '${bridge}'`,
  ]);
  if (!harness) return context.skip();
  const { stdout } = await harness.run();
  const calls = (await readFile(log, "utf8")).trim().split(/\r?\n/);
  expect(calls).toEqual([`start node ${bridge} 172.16.0.1 8318 Hidden`]);
  expect(stdout).toContain("pool bridge already listening on 172.16.0.1:8317");
  expect(stdout).toContain("pool bridge started on 172.16.0.1:8318");
  // The canonical start stays attached to wsl.exe through run-loop.sh.
  const source = await readFile(resolve(executor, "start-loop.ps1"), "utf8");
  expect(source).toContain('-Executable "C:\\Windows\\System32\\wsl.exe"');
  expect(source).toContain(
    '"-d", "Ubuntu", "--", "bash", "/root/orchestration-m1/repo/scripts/executor/run-loop.sh", $Config',
  );
  expect(source).not.toMatch(/Start-Process[^\n]*wsl/);
});

it("the attached parent answers one native-db request and exits with the supervisor", async (context) => {
  const child = resolve(tmpdir(), `start-loop-child-${process.pid}.mjs`);
  cleanup.push(() => rm(child, { force: true }));
  const nativeLossRoot = await mkdtemp(resolve(tmpdir(), "native-db-loss-"));
  cleanup.push(() => rm(nativeLossRoot, { recursive: true, force: true }));
  // Stand-in for wsl.exe: one status line, one request, echo the reply's
  // status as a second line, then exit 0. Worker-shaped JSON is a status line.
  await writeFile(
    child,
    [
      'process.stdout.write(JSON.stringify({ status: "observing-author", run: "synthetic-native-component", cursor: 0 }) + "\\n");',
      'process.stdout.write(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "{}" } }) + "\\n");',
      "process.stderr.write('pnpm banner\\n');",
      "const request = { schemaVersion: 'dogfood-native-db-request/v1', correlation: 1, profile: 'reconciliation-pg16/v1', run: 'synthetic-native-component', issue: 2147483647, attempt: 1, executorHead: 'a'.repeat(40), product: { repository: 'synthetic/native-component', head: 'b'.repeat(40), tree: 'c'.repeat(40) }, declaration: { version: 1, profile: 'reconciliation-pg16/v1', files: [{ file: 'one', cases: ['c'] }, { file: 'two', cases: ['c'] }, { file: 'three', cases: ['c'] }], mutants: [] }, patchDigests: [], stagedInputDirectory: process.argv[2] };",
      'process.stdout.write(JSON.stringify(request) + "\\n");',
      "let buffer = '';",
      "process.stdin.setEncoding('utf8');",
      "process.stdin.on('data', (chunk) => { buffer += chunk; const index = buffer.indexOf('\\n'); if (index === -1) return; const reply = JSON.parse(buffer.slice(0, index)); process.stdout.write(JSON.stringify({ status: 'reply', diagnostic: reply.diagnostic, correlation: reply.correlation, replyStatus: reply.status, keys: Object.keys(reply).join(',') }) + '\\n'); process.exit(0); });",
      "process.stdin.on('end', () => process.exit(9));",
      "",
    ].join("\n"),
  );
  const harness = await startLoopHarness([
    `$loss = Join-Path '${nativeLossRoot}' 'loss'; $code = Start-AttachedSupervisor -Executable '${process.execPath}' -ArgumentList @('${child}', '${tmpdir()}') -LossNoteDirectory $loss -Config '/root/native config.json'; Write-Host "loss=$loss"`,
    'Write-Host "exit=$code"',
  ]);
  if (!harness) return context.skip();
  const { stdout, stderr } = await harness.run();
  const lines = stdout.trim().split(/\r?\n/);
  expect(lines).toEqual([
    '{"status":"observing-author","run":"synthetic-native-component","cursor":0}',
    '{"type":"item.completed","item":{"type":"agent_message","text":"{}"}}',
    expect.stringContaining('"status":"reply"'),
    `loss=${resolve(nativeLossRoot, "loss")}`,
    "exit=0",
  ]);
  expect(JSON.parse(lines[2]!)).toEqual({
    status: "reply",
    diagnostic: "native-db-anchor-unsupported",
    correlation: 1,
    replyStatus: "refused",
    keys: "schemaVersion,correlation,status,owner,evidencePath,diagnostic",
  });
  expect(stderr).toContain("pnpm banner");
  const lossLine = lines.find((line) => line.startsWith("loss="));
  expect(lossLine).toBeDefined();
  const lossDirectory = lossLine!.slice("loss=".length);
  const lossFiles = await readdir(lossDirectory);
  expect(lossFiles).toHaveLength(1);
  const note = JSON.parse(await readFile(resolve(lossDirectory, lossFiles[0]!), "utf8"));
  expect(Object.keys(note).sort()).toEqual([
    "childExitCode",
    "classification",
    "config",
    "kind",
    "lastObservedStatus",
    "observedAt",
    "run",
    "schemaVersion",
  ]);
  expect(note).toMatchObject({
    schemaVersion: "supervisor-loss/v1",
    kind: "supervisor-loss",
    classification: "supervisor loss/unknown outcome",
    run: "synthetic-native-component",
    config: "/root/native config.json",
    lastObservedStatus: "reply",
    childExitCode: 0,
  });
});

it("records attached loss controls at the real PowerShell boundary", async (context) => {
  const shell = await powershell();
  if (!shell) return context.skip();
  const childRoot = await mkdtemp(resolve(tmpdir(), "supervisor-loss-child-"));
  cleanup.push(() =>
    rm(childRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }),
  );
  const child = resolve(childRoot, "child.mjs");
  await writeFile(
    child,
    `
const mode = process.argv[2];
const code = Number(process.argv[3] ?? 0);
const delay = Number(process.argv[4] ?? 0);
const lines = {
  status: [JSON.stringify({ status: "observing-author", run: "synthetic-run" })],
  repeated: [JSON.stringify({ status: "observing-author", run: "synthetic-run" }), JSON.stringify({ status: "complete" })],
  "no-status": [JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "{}" } })],
  malformed: ["not-json"],
  "status-then-no-status": [
    JSON.stringify({ status: "observing-author", run: "synthetic-run" }),
    JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "{}" } }),
  ],
  "status-then-malformed": [
    JSON.stringify({ status: "observing-author", run: "synthetic-run" }),
    "not-json",
    '{"status":',
  ],
  "status-then-unaccepted": [
    JSON.stringify({ status: "observing-author", run: "synthetic-run" }),
    JSON.stringify({ status: 42 }),
    JSON.stringify({ status: "" }),
    JSON.stringify({ status: "x".repeat(129) }),
    JSON.stringify({ status: "complete\\n" }),
    JSON.stringify({ status: "idle\\n", run: "synthetic-run" }),
    JSON.stringify({ status: ["idle"] }),
  ],
  "status-then-bad-run": [
    JSON.stringify({ status: "observing-author", run: "synthetic-run" }),
    JSON.stringify({ status: "complete", run: 42 }),
    JSON.stringify({ status: "complete", run: "" }),
    JSON.stringify({ status: "complete", run: "other-run\\n" }),
    JSON.stringify({ status: "complete", run: "bad run" }),
  ],
  complete: [JSON.stringify({ status: "complete", run: "synthetic-run" })],
  idle: [JSON.stringify({ status: "idle", run: "synthetic-run" })],
  paused: [JSON.stringify({ status: "paused", run: "synthetic-run" })],
};
for (const line of lines[mode] ?? []) process.stdout.write(line + "\\n");
process.exitCode = code;
// Drain stdout and keep sequential attachments apart before the natural exit.
setTimeout(() => {}, delay);
`,
  );
  const config = 'C:/configs/ISS-224;quoted "loop".json';
  let sequence = 0;

  const invoke = async (
    mode: string,
    code: number,
    expectedStatus: string | null,
    expectedRun: string | null,
  ) => {
    const lossName = `${mode}-${code}-${sequence++}`;
    const harness = await startLoopHarness([
      `$loss = Join-Path '${childRoot}' '${lossName}'; $code = Start-AttachedSupervisor -Executable '${process.execPath}' -ArgumentList @('${child}', '${mode}', '${code}', '20') -LossNoteDirectory $loss -Config '${config}'; [Console]::WriteLine(('RESULT:' + ([pscustomobject]@{code=$code; loss=$loss} | ConvertTo-Json -Compress)))`,
    ]);
    if (!harness) throw new Error("PowerShell disappeared during attached-boundary case");
    const started = Date.now();
    const result = await harness.run();
    const finished = Date.now();
    const marker = result.stdout.split(/\r?\n/).find((line) => line.startsWith("RESULT:"));
    expect(marker, result.stdout).toBeDefined();
    const row = JSON.parse(marker!.slice("RESULT:".length)) as { code: number; loss: string };
    expect(row.code).toBe(code);
    const files = await readdir(row.loss);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^\d{8}T\d{9}Z-\d+\.json$/);
    expect(files.filter((file) => file.endsWith(".tmp"))).toHaveLength(0);
    const note = JSON.parse(await readFile(resolve(row.loss, files[0]!), "utf8")) as Record<
      string,
      unknown
    >;
    expect(Object.keys(note).sort()).toEqual([
      "childExitCode",
      "classification",
      "config",
      "kind",
      "lastObservedStatus",
      "observedAt",
      "run",
      "schemaVersion",
    ]);
    expect(note).toMatchObject({
      schemaVersion: "supervisor-loss/v1",
      kind: "supervisor-loss",
      classification: "supervisor loss/unknown outcome",
      run: expectedRun,
      config,
      lastObservedStatus: expectedStatus,
      childExitCode: code,
    });
    const observedAt = Date.parse(String(note.observedAt));
    expect(observedAt).toBeGreaterThanOrEqual(started);
    expect(observedAt).toBeLessThanOrEqual(finished);
  };

  await invoke("status", 0, "observing-author", "synthetic-run");
  await invoke("status", 7, "observing-author", "synthetic-run");
  await invoke("repeated", 0, "complete", "synthetic-run");
  await invoke("no-status", 0, null, null);
  await invoke("malformed", 0, null, null);
  await invoke("complete", 0, "complete", "synthetic-run");
  await invoke("status-then-no-status", 0, "observing-author", "synthetic-run");
  await invoke("status-then-malformed", 7, "observing-author", "synthetic-run");
  await invoke("status-then-unaccepted", 0, "observing-author", "synthetic-run");
  await invoke("status-then-bad-run", 7, "complete", "synthetic-run");

  // idle and paused come from the synthetic child; blocked is the real
  // supervise.mjs usage stop (no config argument), which exits 1 and must be
  // echoed exactly once on the parent stream.
  const terminals = [
    { terminal: "idle", argumentList: `'${child}', 'idle', '9', '20'`, code: 9 },
    { terminal: "paused", argumentList: `'${child}', 'paused', '9', '20'`, code: 9 },
    { terminal: "blocked", argumentList: `'${supervise}'`, code: 1 },
  ];
  for (const { terminal, argumentList, code } of terminals) {
    const lossName = `terminal-${terminal}`;
    const harness = await startLoopHarness([
      `$loss = Join-Path '${childRoot}' '${lossName}'; $code = Start-AttachedSupervisor -Executable '${process.execPath}' -ArgumentList @(${argumentList}) -LossNoteDirectory $loss -Config '${config}'; [Console]::WriteLine(('RESULT:' + ([pscustomobject]@{code=$code; loss=$loss} | ConvertTo-Json -Compress)))`,
    ]);
    if (!harness) throw new Error("PowerShell disappeared during terminal case");
    const result = await harness.run();
    const outputLines = result.stdout.split(/\r?\n/);
    const marker = outputLines.find((line) => line.startsWith("RESULT:"));
    expect(marker, result.stdout).toBeDefined();
    const row = JSON.parse(marker!.slice("RESULT:".length)) as { code: number; loss: string };
    expect(row.code).toBe(code);
    const echoed = outputLines.filter((line) => line.includes(`"status":"${terminal}"`));
    expect(echoed).toHaveLength(1);
    expect(JSON.parse(echoed[0]!)).toMatchObject({ status: terminal });
    if (terminal === "blocked") {
      expect(JSON.parse(echoed[0]!)).toMatchObject({ status: "blocked", reason: "usage" });
      expect(result.stderr.split(/\r?\n/).filter((line) => line === echoed[0])).toHaveLength(1);
    }
    await expect(readdir(row.loss)).rejects.toMatchObject({ code: "ENOENT" });
  }

  const regularParentHarness = await startLoopHarness([
    `$parent = Join-Path '${childRoot}' 'regular-parent'; [IO.File]::WriteAllText($parent, 'x'); $loss = Join-Path $parent 'loss'; $code = Start-AttachedSupervisor -Executable '${process.execPath}' -ArgumentList @('${child}', 'status', '7', '20') -LossNoteDirectory $loss -Config '${config}'; [Console]::WriteLine(('RESULT:' + ([pscustomobject]@{code=$code; loss=$loss} | ConvertTo-Json -Compress)))`,
  ]);
  if (!regularParentHarness) throw new Error("PowerShell disappeared during regular-parent case");
  const regularParentResult = await regularParentHarness.run();
  const regularParentMarker = regularParentResult.stdout
    .split(/\r?\n/)
    .find((line) => line.startsWith("RESULT:"));
  expect(regularParentMarker).toBeDefined();
  const regularParentRow = JSON.parse(regularParentMarker!.slice("RESULT:".length)) as {
    code: number;
    loss: string;
  };
  expect(regularParentRow.code).toBe(7);
  expect(regularParentResult.stderr).toMatch(/supervisor-loss-note-write-failed:/);
  expect(regularParentResult.stderr.length).toBeLessThanOrEqual(2048);
  expect((await stat(resolve(childRoot, "regular-parent"))).isFile()).toBe(true);

  // A config inside the 1024-character bound can still escape past the
  // 4096-byte note cap (each control character serializes as six bytes); that
  // fails closed as a note-write failure with the child code unchanged.
  const escapedConfigHarness = await startLoopHarness([
    `$loss = Join-Path '${childRoot}' 'escaped-config'; $code = Start-AttachedSupervisor -Executable '${process.execPath}' -ArgumentList @('${child}', 'status', '7', '20') -LossNoteDirectory $loss -Config ([string]::new([char]1, 1024)); [Console]::WriteLine(('RESULT:' + ([pscustomobject]@{code=$code; loss=$loss} | ConvertTo-Json -Compress)))`,
  ]);
  if (!escapedConfigHarness) throw new Error("PowerShell disappeared during escaped-config case");
  const escapedConfigResult = await escapedConfigHarness.run();
  const escapedConfigMarker = escapedConfigResult.stdout
    .split(/\r?\n/)
    .find((line) => line.startsWith("RESULT:"));
  expect(escapedConfigMarker).toBeDefined();
  const escapedConfigRow = JSON.parse(escapedConfigMarker!.slice("RESULT:".length)) as {
    code: number;
    loss: string;
  };
  expect(escapedConfigRow.code).toBe(7);
  expect(escapedConfigResult.stderr).toMatch(
    /supervisor-loss-note-write-failed: loss note exceeds 4096 bytes/,
  );
  expect(escapedConfigResult.stderr.length).toBeLessThanOrEqual(2048);
  expect(await readdir(escapedConfigRow.loss)).toEqual([]);

  const sequentialHarness = await startLoopHarness([
    `$loss = Join-Path '${childRoot}' 'sequential'; $first = Start-AttachedSupervisor -Executable '${process.execPath}' -ArgumentList @('${child}', 'status', '0', '80') -LossNoteDirectory $loss -Config '${config}'; $second = Start-AttachedSupervisor -Executable '${process.execPath}' -ArgumentList @('${child}', 'status', '0', '80') -LossNoteDirectory $loss -Config '${config}'; [Console]::WriteLine(('RESULT:' + ([pscustomobject]@{first=$first; second=$second; loss=$loss} | ConvertTo-Json -Compress)))`,
  ]);
  if (!sequentialHarness) throw new Error("PowerShell disappeared during sequential case");
  const sequentialResult = await sequentialHarness.run();
  const sequentialMarker = sequentialResult.stdout
    .split(/\r?\n/)
    .find((line) => line.startsWith("RESULT:"));
  expect(sequentialMarker).toBeDefined();
  const sequentialRow = JSON.parse(sequentialMarker!.slice("RESULT:".length)) as {
    first: number;
    second: number;
    loss: string;
  };
  expect(sequentialRow).toMatchObject({ first: 0, second: 0 });
  expect(await readdir(sequentialRow.loss)).toHaveLength(2);
});

it.skipIf(process.platform !== "linux")(
  "exports the provider and pool status URLs into the attached supervisor",
  async () => {
    const root = await mkdtemp(resolve(tmpdir(), "run-loop-"));
    cleanup.push(() => rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }));
    const taskRoot = resolve(root, "task");
    const binDir = resolve(taskRoot, "tools/cli/node_modules/.bin");
    const fakes = resolve(root, "fakes");
    await mkdir(binDir, { recursive: true });
    await mkdir(resolve(taskRoot, "codex-home"), { recursive: true });
    await mkdir(resolve(taskRoot, "repo"));
    await mkdir(fakes);
    // ISS-219: the entry execs the tools' Node before any other subprocess.
    await mkdir(resolve(taskRoot, "tools/node-v24.15.0-linux-x64/bin"), { recursive: true });
    await symlink(process.execPath, resolve(taskRoot, "tools/node-v24.15.0-linux-x64/bin/node"));
    const result = resolve(root, "result.json");
    await writeFile(
      resolve(taskRoot, "codex-home/config.toml"),
      'base_url = "http://172.23.240.1:8317/v1"\n',
    );
    await writeFile(resolve(taskRoot, "pool-key.sh"), "#!/bin/sh\necho key\n", { mode: 0o700 });
    // ISS-164: run-loop.sh runs pnpm attached from the tools directory. This
    // double records the environment it inherited, echoes one protocol line
    // to stdout after reading one reply from stdin, and writes a banner to
    // stderr, which must reach the log rather than the protocol stream.
    await writeFile(
      resolve(binDir, "pnpm"),
      `#!/bin/sh\nprintf '{"args":"%s","base":"%s","status":"%s","auth":"%s","home":"%s","cwd":"%s","ppid":"%s","bindings":"%s"}' "$*" "$CODEX_PROVIDER_BASE_URL" "$CODEX_POOL_STATUS_URL" "$CODEX_PROVIDER_AUTH_COMMAND" "$CODEX_HOME" "$(pwd)" "$PPID" "$(ls '${resolve(root, "state/attached/process-ownership")}'/*/binding.json | wc -l)" > '${result}'\necho 'banner' >&2\nread -r reply\nprintf '{"status":"idle","reply":"%s"}\\n' "$reply"\nexit 3\n`,
      { mode: 0o700 },
    );
    await writeFile(resolve(fakes, "ip"), "#!/bin/sh\necho 'default via 10.9.8.7 dev eth0'\n", {
      mode: 0o700,
    });
    const config = resolve(root, "loop.json");
    await writeFile(
      config,
      `${JSON.stringify({ schemaVersion: "dogfood-loop/v1", run: "attached", stateRoot: resolve(root, "state") })}\n`,
    );
    const outcome = await new Promise<{ code: number | null; stdout: string; stderr: string }>(
      (done, reject) => {
        const child = spawn("bash", [resolve(executor, "run-loop.sh"), config], {
          stdio: ["pipe", "pipe", "pipe"],
          env: {
            ...process.env,
            TASK_ROOT: taskRoot,
            PATH: `${fakes}:${process.env.PATH}`,
            // A plain injected directory; the real /sys/fs/cgroup is never touched.
            ORCHESTRATION_CGROUP_ROOT: resolve(root, "cgroups"),
          },
        });
        let stdout = "";
        let stderr = "";
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk) => (stdout += chunk));
        child.stderr.on("data", (chunk) => (stderr += chunk));
        child.once("error", reject);
        child.once("close", (code) => done({ code, stdout, stderr }));
        child.stdin.end("reply-line\n");
      },
    );
    // The parent sees only protocol lines and the supervisor's exit code.
    expect(outcome).toEqual({
      code: 3,
      stdout: '{"status":"idle","reply":"reply-line"}\n',
      stderr: "",
    });
    const recorded = JSON.parse(await readFile(result, "utf8"));
    expect(recorded).toEqual({
      args: `--silent loop:supervise ${config}`,
      base: "http://10.9.8.7:8317/v1",
      status: "http://10.9.8.7:8318/api/status",
      auth: resolve(taskRoot, "pool-key.sh"),
      home: resolve(taskRoot, "codex-home"),
      cwd: resolve(taskRoot, "repo"),
      ppid: expect.stringMatching(/^\d+$/),
      bindings: "1",
    });
    // The supervisor saw the published binding; its parent shell is the
    // wrapper's first child, and the wrapper enrolled only itself.
    const [invocation] = await readdir(resolve(root, "state/attached/process-ownership"));
    const binding = JSON.parse(
      await readFile(
        resolve(root, "state/attached/process-ownership", invocation!, "binding.json"),
        "utf8",
      ),
    );
    expect(binding).toMatchObject({
      schemaVersion: "dogfood-process-ownership/v1",
      run: "attached",
      configPath: config,
      invocation,
      substrate: "injected-directory",
      cgroupPath: resolve(root, "cgroups", invocation!),
      wrapper: { pid: expect.any(Number), starttime: expect.stringMatching(/^\d+$/) },
    });
    expect(await readFile(resolve(binding.cgroupPath, "cgroup.procs"), "utf8")).toBe(
      `${binding.wrapper.pid}\n`,
    );
    expect(await readFile(resolve(taskRoot, "codex-home/config.toml"), "utf8")).toBe(
      'base_url = "http://10.9.8.7:8317/v1"\n',
    );
    expect(await readFile(resolve(root, "supervisor.log"), "utf8")).toBe(
      'banner\n{"status":"idle","reply":"reply-line"}\n',
    );
    const script = await readFile(resolve(executor, "run-loop.sh"), "utf8");
    for (const word of ["setsid", "nohup", "disown", "LOOP_DETACHED"])
      expect(script).not.toContain(word);
    // Before the exec only builtins and parameter expansions run: no command
    // substitution, pipeline or external command precedes enrollment.
    const [head] = script.split("# ISS-219 ATTACHED BODY\n");
    const commands = head!
      .split("\n")
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => line.trim());
    expect(commands).toEqual([
      "set -eu",
      'TASK_ROOT="${TASK_ROOT:-/root/orchestration-m1}"',
      'CONFIG="${1:-$TASK_ROOT/loop.json}"',
      'SELF="${BASH_SOURCE[0]}"',
      '[[ "$SELF" == */* ]] || SELF="./$SELF"',
      'exec "$TASK_ROOT/tools/node-v24.15.0-linux-x64/bin/node" "${SELF%/*}/../dogfood/process-ownership.mjs" "$CONFIG" "$SELF"',
    ]);
    for (const line of commands) expect(line).not.toMatch(/\$\(|`|[^|]\|[^|]/);
  },
);

// ISS-193: the retried fixture-root cleanup is bounded and never swallows a
// genuinely held root. Only a child's working directory pins a directory on
// Windows; libuv opens this process's own handles with FILE_SHARE_DELETE.
it.skipIf(process.platform !== "win32")(
  "fixture-root cleanup still fails on a persistently held Windows directory",
  async () => {
    const root = await mkdtemp(resolve(tmpdir(), "held-root-"));
    const held = resolve(root, "executor");
    await mkdir(held);
    const holder = resolve(root, "holder.mjs");
    await writeFile(holder, 'process.stdout.write("holding\\n");\nsetInterval(() => {}, 1000);\n');
    const child = spawn(process.execPath, [holder], {
      cwd: held,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const done = exited(child);
    try {
      const banner = await Promise.race([
        new Promise<string>((ok) => child.stdout!.once("data", (chunk) => ok(String(chunk)))),
        done.then(({ code, stderr }) => {
          throw new Error(`holder exited ${code}: ${stderr}`);
        }),
      ]);
      expect(banner.trim()).toBe("holding");
      await expect(
        rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }),
      ).rejects.toMatchObject({ code: expect.stringMatching(/^(EBUSY|EPERM)$/) });
      expect((await stat(held)).isDirectory()).toBe(true);
    } finally {
      child.kill();
      await done;
      await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  },
);
