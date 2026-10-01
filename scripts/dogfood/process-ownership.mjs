// ISS-219: one cgroup-v2 leaf per canonical launcher invocation, one immutable
// binding, one read-only census. Identities only: no signal, freeze, kill,
// cleanup, per-child ledger or stop verdict lives here.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeSync } from "node:fs";
import { mkdir, open, readFile, readdir, readlink, rename, stat, statfs } from "node:fs/promises";
import { constants as osConstants } from "node:os";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PROCESS_OWNERSHIP_SCHEMA = "dogfood-process-ownership/v1";
export const DEFAULT_CGROUP_ROOT = "/sys/fs/cgroup/orchestration-platform";
export const BODY_MARKER = "# ISS-219 ATTACHED BODY\n";
const CGROUP2_SUPER_MAGIC = 0x63677270;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const fail = (category) => {
  throw new Error(category);
};
const now = () => new Date().toISOString();
const category = (error, fallback) =>
  typeof error?.message === "string" && error.message.startsWith("ownership-")
    ? error.message
    : fallback;

// /proc/<pid>/stat: "pid (comm) state ppid pgid sid ... starttime ..." where comm
// may itself contain spaces and parentheses, so the row splits at the last ")".
export function parseProcStat(text) {
  const close = text.lastIndexOf(")");
  const open = text.indexOf("(");
  if (open < 1 || close < open) fail("ownership-proc-malformed");
  const pid = Number(text.slice(0, open).trim());
  const fields = text
    .slice(close + 1)
    .trim()
    .split(/\s+/);
  const [state, ppid, pgid, sid] = fields;
  const starttime = fields[19];
  if (
    !/^[1-9]\d*$/.test(text.slice(0, open).trim()) ||
    !/^[A-Za-z]$/.test(state ?? "") ||
    ![ppid, pgid, sid].every((field) => /^\d+$/.test(field ?? "")) ||
    !/^\d+$/.test(starttime ?? "")
  )
    fail("ownership-proc-malformed");
  return { pid, starttime, ppid: Number(ppid), pgid: Number(pgid), sid: Number(sid), state };
}

export async function readProcIdentity(pid, procRoot = "/proc") {
  let text;
  try {
    text = await readFile(resolve(procRoot, String(pid), "stat"), "utf8");
  } catch {
    fail("ownership-member-unreadable");
  }
  const row = parseProcStat(text);
  if (row.pid !== pid) fail("ownership-proc-malformed");
  return row;
}

// The kernel membership record. It is never derived from a supplied list,
// a parent chain, SID/PGID or argv.
export async function readCgroupMembership(leaf) {
  let text;
  try {
    text = await readFile(resolve(leaf, "cgroup.procs"), "utf8");
  } catch {
    fail("ownership-membership-unreadable");
  }
  const tokens = text.split(/\s+/).filter(Boolean);
  if (!tokens.every((token) => /^[1-9]\d*$/.test(token) && Number.isSafeInteger(Number(token))))
    fail("ownership-membership-malformed");
  return [...new Set(tokens.map(Number))].sort((a, b) => a - b);
}

async function kernelIdentity(procRoot) {
  const bootId = (await readFile(resolve(procRoot, "sys/kernel/random/boot_id"), "utf8")).trim();
  const namespaces = {};
  for (const name of ["pid", "cgroup", "mnt"])
    namespaces[name] = await readlink(resolve(procRoot, "self/ns", name));
  if (!/^[0-9a-f-]{36}$/.test(bootId)) fail("ownership-boot-unavailable");
  return { bootId, namespaces };
}

async function leafIdentity(path, substrate) {
  if (substrate !== "injected-directory" && (await statfs(path)).type !== CGROUP2_SUPER_MAGIC)
    fail("ownership-cgroup-unsupported");
  if ((await readdir(path, { withFileTypes: true })).some((row) => row.isDirectory()))
    fail("ownership-not-a-leaf");
  const row = await stat(path, { bigint: true });
  return { device: String(row.dev), inode: String(row.ino) };
}

function validBinding(binding, run, invocation) {
  return (
    binding?.schemaVersion === PROCESS_OWNERSHIP_SCHEMA &&
    binding.run === run &&
    binding.invocation === invocation &&
    typeof binding.bootId === "string" &&
    typeof binding.cgroupPath === "string" &&
    ["cgroup-v2", "injected-directory"].includes(binding.substrate) &&
    typeof binding.namespaces?.pid === "string" &&
    typeof binding.cgroupIdentity?.inode === "string" &&
    typeof binding.wrapper?.starttime === "string"
  );
}

async function invocationNames(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  if (entries.some((row) => !row.isDirectory())) fail("ownership-invocation-unresolved");
  return entries.map((row) => row.name).sort();
}

async function readBinding(directory, run, invocation) {
  let binding;
  try {
    binding = JSON.parse(await readFile(resolve(directory, invocation, "binding.json"), "utf8"));
  } catch (error) {
    fail(
      error?.code === "ENOENT" ? "ownership-invocation-unresolved" : "ownership-binding-malformed",
    );
  }
  if (!validBinding(binding, run, invocation)) fail("ownership-binding-malformed");
  return binding;
}

/**
 * One bounded read-only census of every retained invocation of a run. The
 * result is complete or unavailable: an unresolved invocation, a moved or
 * unsupported leaf, another boot or namespace, an unreadable member, or any
 * membership/identity change around the census makes the whole observation
 * unavailable with every `members` null. Historical bindings stay readable.
 */
export async function observeProcessOwnership(stateRoot, run, options = {}) {
  const observationStart = now();
  const invocations = [];
  const unavailable = (diagnostic) => ({
    status: "unavailable",
    diagnostic,
    observationStart,
    observationEnd: now(),
    invocations: invocations.map((row) => ({ ...row, members: null })),
  });
  if (process.platform !== "linux") return unavailable("ownership-linux-unsupported");
  const procRoot = options.procRoot ?? "/proc";
  const directory = resolve(stateRoot, run, "process-ownership");
  try {
    let names;
    try {
      names = await invocationNames(directory);
    } catch (error) {
      if (error?.code === "ENOENT") fail("ownership-record-missing");
      throw error;
    }
    if (!names.length) fail("ownership-record-missing");
    for (const invocation of names) {
      let binding = null;
      try {
        binding = await readBinding(directory, run, invocation);
      } catch {
        binding = null;
      }
      invocations.push({ invocation, binding, members: null });
    }
    if (invocations.some((row) => !row.binding)) fail("ownership-invocation-unresolved");
    const kernel = await kernelIdentity(procRoot);
    const capture = async () => {
      const rows = [];
      for (const invocation of names) {
        const binding = await readBinding(directory, run, invocation);
        if (binding.bootId !== kernel.bootId) fail("ownership-boot-mismatch");
        if (!same(binding.namespaces, kernel.namespaces)) fail("ownership-namespace-mismatch");
        if (
          !same(await leafIdentity(binding.cgroupPath, binding.substrate), binding.cgroupIdentity)
        )
          fail("ownership-cgroup-changed");
        const members = [];
        for (const pid of await readCgroupMembership(binding.cgroupPath))
          members.push(await readProcIdentity(pid, procRoot));
        rows.push({ invocation, binding, members });
      }
      return rows;
    };
    // Two complete samples of records, kernel identity, leaves, membership and
    // member identities. A set change or the same PID with another starttime
    // (a reused PID) is churn, not a stable census. State and parent come from
    // the second sample; they are observations, not identity.
    const first = await capture();
    const second = await capture();
    const identity = (rows) =>
      rows.map((row) => row.members.map((member) => [member.pid, member.starttime]));
    if (
      !same(identity(first), identity(second)) ||
      !same(names, await invocationNames(directory)) ||
      !same(kernel, await kernelIdentity(procRoot))
    )
      fail("ownership-census-changed");
    return { status: "observed", observationStart, observationEnd: now(), invocations: second };
  } catch (error) {
    // Bounded categories only: no acquired JSON, argv, environment or raw errors.
    return unavailable(category(error, "ownership-observation-unavailable"));
  }
}

/**
 * The canonical launcher's pre-spawn boundary. Called by run-loop.sh through
 * `exec`, so this process is the launcher process: it creates a fresh leaf,
 * moves only itself into it, confirms membership, publishes the binding
 * atomically, and only then starts the attached launcher body as its first
 * child with inherited stdio. Any failure before that refuses the launch.
 */
export async function launchOwned(configPath, launcherPath, environment = process.env) {
  if (process.platform !== "linux") fail("ownership-linux-unsupported");
  let config;
  try {
    config = JSON.parse(await readFile(configPath, "utf8"));
  } catch {
    fail("ownership-config-invalid");
  }
  if (
    config?.schemaVersion !== "dogfood-loop/v1" ||
    typeof config.run !== "string" ||
    !/^[\w.-]{1,64}$/.test(config.run) ||
    [".", ".."].includes(config.run) ||
    typeof config.stateRoot !== "string" ||
    !isAbsolute(config.stateRoot)
  )
    fail("ownership-config-invalid");
  const launcher = await readFile(launcherPath, "utf8");
  const marker = launcher.indexOf(BODY_MARKER);
  if (marker < 0) fail("ownership-launcher-body-missing");
  const body = launcher.slice(marker + BODY_MARKER.length);
  const invocation = randomUUID();
  const records = resolve(config.stateRoot, config.run, "process-ownership");
  await mkdir(records, { recursive: true });
  const directory = resolve(records, invocation);
  // Non-recursive: an existing invocation directory or leaf is never reused.
  // An interrupted preparation stays an unresolved invocation, never emptiness.
  await mkdir(directory);
  const injected = environment.ORCHESTRATION_CGROUP_ROOT;
  const substrate = injected ? "injected-directory" : "cgroup-v2";
  const root = resolve(injected || DEFAULT_CGROUP_ROOT);
  if (substrate === "cgroup-v2" && (await statfs("/sys/fs/cgroup")).type !== CGROUP2_SUPER_MAGIC)
    fail("ownership-cgroup-unsupported");
  await mkdir(root, { recursive: true });
  const cgroupPath = resolve(root, invocation);
  await mkdir(cgroupPath);
  const procs = await open(
    resolve(cgroupPath, "cgroup.procs"),
    substrate === "injected-directory" ? "wx" : "r+",
  );
  try {
    await procs.writeFile(`${process.pid}\n`);
  } finally {
    await procs.close();
  }
  if (!same(await readCgroupMembership(cgroupPath), [process.pid]))
    fail("ownership-enrollment-failed");
  const binding = {
    schemaVersion: PROCESS_OWNERSHIP_SCHEMA,
    run: config.run,
    configPath: resolve(configPath),
    invocation,
    ...(await kernelIdentity("/proc")),
    cgroupPath,
    cgroupIdentity: await leafIdentity(cgroupPath, substrate),
    substrate,
    wrapper: await readProcIdentity(process.pid),
    createdAt: now(),
  };
  const temporary = resolve(directory, "binding.tmp");
  const handle = await open(temporary, "wx");
  try {
    await handle.writeFile(`${JSON.stringify(binding)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, resolve(directory, "binding.json"));
  // First child, after enrollment and publication. Inherited stdio keeps the
  // ISS-164 protocol stream and log routing; the body reapplies its own PATH,
  // exports and `exec 2>>` exactly as before. Workers still receive only the
  // dispatch allowlist, so an injected root never reaches a worker.
  const child = spawn("/bin/bash", ["-c", body, resolve(launcherPath), resolve(configPath)], {
    stdio: "inherit",
    env: environment,
  });
  return new Promise((done, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) =>
      done(code ?? (signal ? 128 + osConstants.signals[signal] : 1)),
    );
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await launchOwned(process.argv[2], process.argv[3]);
  } catch (error) {
    writeSync(
      2,
      `process ownership unavailable: ownership-launch-refused (${category(error, "ownership-launch-failed")})\n`,
    );
    process.exitCode = 1;
  }
}
