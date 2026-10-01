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
    if (launch)
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
        loss: resolve(root, "local app", "orchestration-platform\\supervisor-loss"),
        config,
      });
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
  complete: [JSON.stringify({ status: "complete", run: "synthetic-run" })],
  idle: [JSON.stringify({ status: "idle", run: "synthetic-run" })],
  paused: [JSON.stringify({ status: "paused", run: "synthetic-run" })],
  blocked: [JSON.stringify({ status: "blocked", run: "synthetic-run" })],
};
for (const line of lines[mode] ?? []) process.stdout.write(line + "\\n");
setTimeout(() => process.exit(code), delay);
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

  for (const terminal of ["idle", "paused", "blocked"] as const) {
    const lossName = `terminal-${terminal}`;
    const harness = await startLoopHarness([
      `$loss = Join-Path '${childRoot}' '${lossName}'; $code = Start-AttachedSupervisor -Executable '${process.execPath}' -ArgumentList @('${child}', '${terminal}', '9', '20') -LossNoteDirectory $loss -Config '${config}'; [Console]::WriteLine(('RESULT:' + ([pscustomobject]@{code=$code; loss=$loss} | ConvertTo-Json -Compress)))`,
    ]);
    if (!harness) throw new Error("PowerShell disappeared during terminal case");
    const result = await harness.run();
    const marker = result.stdout.split(/\r?\n/).find((line) => line.startsWith("RESULT:"));
    expect(marker, result.stdout).toBeDefined();
    const row = JSON.parse(marker!.slice("RESULT:".length)) as { code: number; loss: string };
    expect(row.code).toBe(9);
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
