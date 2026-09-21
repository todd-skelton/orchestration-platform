// ISS-164: Node stand-in for the attached Windows parent (start-loop.ps1).
// Same redirected stdio shape: the child's stdout is the protocol stream,
// replies go to its stdin, stderr is drained concurrently. One bound run, one
// increasing correlation, typed refusals; the inert incumbent seam is a Node
// script standing in for `invoke-heavy-verifier.ps1 -NativeDbProfile`.
import { execFile, spawn } from "node:child_process";
import { closeSync, constants, existsSync, openSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { Socket } from "node:net";
import { dirname, resolve, sep } from "node:path";
import { createInterface } from "node:readline";
import { promisify } from "node:util";

const REQUEST_SCHEMA = "dogfood-native-db-request/v1";
const REPLY_SCHEMA = "dogfood-native-db-reply/v1";
const REQUEST_KEYS = [
  "schemaVersion",
  "correlation",
  "profile",
  "run",
  "issue",
  "attempt",
  "executorHead",
  "product",
  "declaration",
  "patchDigests",
  "stagedInputDirectory",
];
const REPLY_KEYS = [
  "schemaVersion",
  "correlation",
  "status",
  "owner",
  "evidencePath",
  "diagnostic",
];
const control = JSON.parse(await readFile(process.argv[2], "utf8"));
const environment = { ...process.env, ...(control.env ?? {}) };
const record = {
  lines: [],
  requests: [],
  replies: [],
  incumbent: [],
  unaccepted: [],
  stderr: "",
  exit: null,
};
const finish = async (code) => {
  await writeFile(control.record, `${JSON.stringify(record, null, 2)}\n`);
  process.exit(code);
};
const reply = (correlation, status, diagnostic, extra = {}) => ({
  schemaVersion: REPLY_SCHEMA,
  correlation,
  status,
  owner: null,
  evidencePath: null,
  diagnostic,
  ...extra,
});
let boundRun = "";
let lastCorrelation = 0;
const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const validate = (message) => {
  const names = Object.keys(message);
  for (const key of REQUEST_KEYS)
    if (!names.includes(key)) return `native-db-request-invalid: request.${key} is required`;
  for (const name of names)
    if (!REQUEST_KEYS.includes(name))
      return `native-db-request-invalid: request.${name} is not a v1 key`;
  if (message.profile !== "reconciliation-pg16/v1")
    return "native-db-request-invalid: request.profile";
  if (!Number.isSafeInteger(message.correlation) || message.correlation < 1)
    return "native-db-request-invalid: request.correlation";
  if (message.correlation <= lastCorrelation)
    return "native-db-request-invalid: request.correlation is not increasing";
  if (typeof message.run !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(message.run))
    return "native-db-request-invalid: request.run";
  if (boundRun && message.run !== boundRun)
    return "native-db-request-invalid: request.run is not the bound run";
  for (const key of ["issue", "attempt"])
    if (!Number.isSafeInteger(message[key]) || message[key] < 1 || message[key] > 2147483647)
      return `native-db-request-invalid: request.${key}`;
  if (typeof message.executorHead !== "string" || !/^[0-9a-f]{40}$/.test(message.executorHead))
    return "native-db-request-invalid: request.executorHead";
  for (const key of ["product", "declaration"])
    if (!isObject(message[key]))
      return `native-db-request-invalid: request.${key} must be an object`;
  if (!Array.isArray(message.patchDigests))
    return "native-db-request-invalid: request.patchDigests must be a list";
  if (
    typeof message.stagedInputDirectory !== "string" ||
    !resolve(message.stagedInputDirectory).startsWith(sep)
  )
    return "native-db-request-invalid: request.stagedInputDirectory must be absolute";
  return undefined;
};
const runIncumbent = (wrapper, args) =>
  new Promise((done) => {
    execFile(process.execPath, [wrapper, ...args], { env: environment }, (error, stdout, stderr) =>
      done({ error, stdout, stderr }),
    );
  });
const invoke = async (line, message, correlation) => {
  const anchor = control.verifierWorktree;
  if (!anchor) return reply(correlation, "refused", "native-db-anchor-unsupported");
  if (!existsSync(anchor.wrapper)) return reply(correlation, "refused", "native-db-runner-absent");
  try {
    await mkdir(anchor.artifacts, { recursive: true });
    const requestPath = resolve(anchor.artifacts, `${message.run}-${correlation}.json`);
    await writeFile(requestPath, `${line}\n`);
    record.requests.push({ correlation, path: requestPath });
    const replyPath = `${requestPath}.reply.json`;
    const outcome = await runIncumbent(anchor.wrapper, [
      requestPath,
      anchor.worktree,
      message.run,
      anchor.branch,
      anchor.head,
    ]);
    record.incumbent.push({ correlation, exit: outcome.error ? (outcome.error.code ?? null) : 0 });
    if (!existsSync(replyPath)) return reply(correlation, "unknown", "native-db-runner-no-reply");
    const value = JSON.parse(await readFile(replyPath, "utf8"));
    const names = Object.keys(value);
    if (
      names.length !== REPLY_KEYS.length ||
      REPLY_KEYS.some((key) => !names.includes(key)) ||
      value.schemaVersion !== REPLY_SCHEMA ||
      value.correlation !== correlation
    )
      return reply(correlation, "unknown", "native-db-runner-reply-invalid");
    if (
      value.evidencePath !== null &&
      !String(value.evidencePath).startsWith(anchor.worktree + sep)
    )
      return reply(correlation, "unknown", "native-db-runner-evidence-outside-anchor");
    return reply(correlation, value.status, value.diagnostic, {
      owner: value.owner,
      evidencePath: value.evidencePath,
    });
  } catch (error) {
    return reply(correlation, "unknown", `native-db-runner-failed: ${error.message}`);
  }
};

// wsl.exe hands the supervisor pipes, so the child gets real pipe fds: FIFOs
// on POSIX (spawn's socketpairs read as unknown handles inside the worker
// sandbox), spawn pipes on Windows, which has no FIFOs.
async function attachedStdio() {
  if (process.platform === "win32")
    return {
      stdio: ["pipe", "pipe", "pipe"],
      attach: (child) => ({ input: child.stdout, output: child.stdin }),
    };
  const directory = dirname(control.record);
  const inbound = resolve(directory, "child-stdout.fifo");
  const outbound = resolve(directory, "child-stdin.fifo");
  await promisify(execFile)("mkfifo", [inbound, outbound]);
  const inboundRead = openSync(inbound, constants.O_RDONLY | constants.O_NONBLOCK);
  const inboundWrite = openSync(inbound, constants.O_WRONLY);
  const outboundRead = openSync(outbound, constants.O_RDONLY | constants.O_NONBLOCK);
  const outboundWrite = openSync(outbound, constants.O_WRONLY);
  return {
    stdio: [outboundRead, inboundWrite, "pipe"],
    attach: () => {
      closeSync(outboundRead);
      closeSync(inboundWrite);
      return {
        input: new Socket({ fd: inboundRead, readable: true, writable: false }),
        output: new Socket({ fd: outboundWrite, readable: false, writable: true }),
      };
    },
  };
}
const { stdio, attach } = await attachedStdio();
const child = spawn(control.executable, control.args, {
  stdio,
  env: environment,
});
child.once("error", async (error) => {
  record.startFailure = error.message;
  await finish(1);
});
const { input, output } = attach(child);
child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => (record.stderr += chunk));
let queue = Promise.resolve();
const lines = createInterface({ input, crlfDelay: Infinity });
lines.on("line", (line) => {
  queue = queue.then(async () => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      message = undefined;
    }
    if (!isObject(message)) {
      record.unaccepted.push(line);
      return;
    }
    if (message.schemaVersion !== REQUEST_SCHEMA) {
      record.lines.push(message);
      return;
    }
    if (control.loss) {
      record.loss = true;
      await finish(3);
    }
    const diagnostic = validate(message);
    const correlation = Number.isSafeInteger(message.correlation) ? message.correlation : 0;
    let answer;
    if (diagnostic) answer = reply(correlation, "refused", diagnostic);
    else {
      boundRun = message.run;
      lastCorrelation = correlation;
      answer = await invoke(line, message, correlation);
    }
    record.replies.push(answer);
    output.write(`${JSON.stringify(answer)}\n`);
  });
});
// Exit and stream EOF each arrive once; finish after the last line is handled.
let exited;
let drained = false;
const complete = () => {
  if (!exited || !drained) return;
  queue.then(async () => {
    record.exit = exited;
    await finish(exited.code ?? 1);
  });
};
child.once("exit", (code, signal) => {
  exited = { code, signal };
  complete();
});
lines.once("close", () => {
  drained = true;
  complete();
});
process.once("SIGTERM", () => {
  record.cancelled = true;
  output.end();
  const timer = setTimeout(() => child.kill(), 5000);
  child.once("exit", () => clearTimeout(timer));
});
