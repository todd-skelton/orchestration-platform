import { execFile, spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
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
  // Stand-in for wsl.exe: one status line, one request, echo the reply's
  // status as a second line, then exit 0. Worker-shaped JSON is a status line.
  await writeFile(
    child,
    [
      'process.stdout.write(JSON.stringify({ status: "observing-author", cursor: 0 }) + "\\n");',
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
    `$code = Start-AttachedSupervisor -Executable '${process.execPath}' -ArgumentList @('${child}', '${tmpdir()}')`,
    'Write-Host "exit=$code"',
  ]);
  if (!harness) return context.skip();
  const { stdout, stderr } = await harness.run();
  const lines = stdout.trim().split(/\r?\n/);
  expect(lines).toEqual([
    '{"status":"observing-author","cursor":0}',
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
      `#!/bin/sh\nprintf '{"args":"%s","base":"%s","status":"%s","auth":"%s","home":"%s","cwd":"%s"}' "$*" "$CODEX_PROVIDER_BASE_URL" "$CODEX_POOL_STATUS_URL" "$CODEX_PROVIDER_AUTH_COMMAND" "$CODEX_HOME" "$(pwd)" > '${result}'\necho 'banner' >&2\nread -r reply\nprintf '{"status":"idle","reply":"%s"}\\n' "$reply"\nexit 3\n`,
      { mode: 0o700 },
    );
    await writeFile(resolve(fakes, "ip"), "#!/bin/sh\necho 'default via 10.9.8.7 dev eth0'\n", {
      mode: 0o700,
    });
    const config = resolve(root, "loop.json");
    await writeFile(config, "{}\n");
    const outcome = await new Promise<{ code: number | null; stdout: string; stderr: string }>(
      (done, reject) => {
        const child = spawn("bash", [resolve(executor, "run-loop.sh"), config], {
          stdio: ["pipe", "pipe", "pipe"],
          env: { ...process.env, TASK_ROOT: taskRoot, PATH: `${fakes}:${process.env.PATH}` },
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
    const recorded = await readFile(result, "utf8");
    expect(JSON.parse(recorded)).toEqual({
      args: `--silent loop:supervise ${config}`,
      base: "http://10.9.8.7:8317/v1",
      status: "http://10.9.8.7:8318/api/status",
      auth: resolve(taskRoot, "pool-key.sh"),
      home: resolve(taskRoot, "codex-home"),
      cwd: resolve(taskRoot, "repo"),
    });
    expect(await readFile(resolve(taskRoot, "codex-home/config.toml"), "utf8")).toBe(
      'base_url = "http://10.9.8.7:8317/v1"\n',
    );
    expect(await readFile(resolve(root, "supervisor.log"), "utf8")).toBe(
      'banner\n{"status":"idle","reply":"reply-line"}\n',
    );
    const script = await readFile(resolve(executor, "run-loop.sh"), "utf8");
    for (const word of ["setsid", "nohup", "disown", "LOOP_DETACHED"])
      expect(script).not.toContain(word);
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
