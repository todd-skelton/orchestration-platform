import { execFile, spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

it("starts one bridge per missing port before launching the loop", async (context) => {
  const shell = await powershell();
  if (!shell) return context.skip();
  const root = await mkdtemp(resolve(tmpdir(), "start-loop-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const log = resolve(root, "calls.log");
  const script = resolve(executor, "start-loop.ps1");
  // Cmdlet doubles: functions win over cmdlets by name, so the script sees a
  // WSL adapter at 172.16.0.1 with 8317 already listening and 8318 free.
  await writeFile(
    resolve(root, "harness.ps1"),
    [
      "function Get-NetIPAddress { @([pscustomobject]@{ InterfaceAlias = 'Ethernet'; IPAddress = '10.0.0.5' }, [pscustomobject]@{ InterfaceAlias = 'vEthernet (WSL (Hyper-V firewall))'; IPAddress = '172.16.0.1' }) }",
      "function Get-NetTCPConnection { param($State, $LocalAddress, $LocalPort, $ErrorAction) if ($State -eq 'Listen' -and $LocalAddress -eq '172.16.0.1' -and $LocalPort -eq 8317) { [pscustomobject]@{ LocalPort = 8317 } } }",
      `function Start-Process { param($FilePath, $ArgumentList, $WindowStyle) Add-Content -LiteralPath '${log}' -Value ('start ' + $FilePath + ' ' + ($ArgumentList -join ' ') + ' ' + $WindowStyle) }`,
      "function Start-Sleep { }",
      `function wsl { Add-Content -LiteralPath '${log}' -Value ('wsl ' + ($args -join ' ')) }`,
      `. '${script}' -Config /root/orchestration-m2/loop.json`,
      "",
    ].join("\n"),
  );
  const { stdout } = await exec(
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
  const calls = (await readFile(log, "utf8")).trim().split(/\r?\n/);
  expect(calls).toEqual([
    `start node ${bridge} 172.16.0.1 8318 Hidden`,
    // PowerShell consumes the "--" end-of-parameters token before a function sees $args.
    "wsl -d Ubuntu bash /root/orchestration-m1/repo/scripts/executor/run-loop.sh /root/orchestration-m2/loop.json",
  ]);
  expect(stdout).toContain("pool bridge already listening on 172.16.0.1:8317");
  expect(stdout).toContain("pool bridge started on 172.16.0.1:8318");
});

it.skipIf(process.platform !== "linux")(
  "exports the provider and pool status URLs into the detached supervisor",
  async () => {
    const root = await mkdtemp(resolve(tmpdir(), "run-loop-"));
    cleanup.push(() => rm(root, { recursive: true, force: true }));
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
    // The detached branch execs pnpm from the tools directory; this double
    // records the environment it inherited.
    await writeFile(
      resolve(binDir, "pnpm"),
      `#!/bin/sh\nprintf '{"args":"%s","base":"%s","status":"%s","auth":"%s","home":"%s","cwd":"%s"}' "$*" "$CODEX_PROVIDER_BASE_URL" "$CODEX_POOL_STATUS_URL" "$CODEX_PROVIDER_AUTH_COMMAND" "$CODEX_HOME" "$(pwd)" > '${result}'\n`,
      { mode: 0o700 },
    );
    await writeFile(resolve(fakes, "ip"), "#!/bin/sh\necho 'default via 10.9.8.7 dev eth0'\n", {
      mode: 0o700,
    });
    const config = resolve(root, "loop.json");
    await writeFile(config, "{}\n");
    const env = { ...process.env };
    delete env.LOOP_DETACHED;
    const { stdout } = await exec("bash", [resolve(executor, "run-loop.sh"), config], {
      env: { ...env, TASK_ROOT: taskRoot, PATH: `${fakes}:${process.env.PATH}` },
    });
    expect(stdout).toMatch(/^loop started in background \(pid \d+\) with /);
    let recorded = "";
    for (let count = 0; count < 100 && !recorded; count += 1) {
      recorded = await readFile(result, "utf8").catch(() => "");
      if (!recorded) await new Promise((done) => setTimeout(done, 100));
    }
    expect(JSON.parse(recorded)).toEqual({
      args: `loop:supervise ${config}`,
      base: "http://10.9.8.7:8317/v1",
      status: "http://10.9.8.7:8318/api/status",
      auth: resolve(taskRoot, "pool-key.sh"),
      home: resolve(taskRoot, "codex-home"),
      cwd: resolve(taskRoot, "repo"),
    });
    expect(await readFile(resolve(taskRoot, "codex-home/config.toml"), "utf8")).toBe(
      'base_url = "http://10.9.8.7:8317/v1"\n',
    );
    expect(await readFile(resolve(root, "supervisor.log"), "utf8")).toBe("");
  },
);
