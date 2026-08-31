import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson } from "../../../packages/contracts/src/runtime.ts";
import {
  absolute,
  checkReference,
  fileGuard,
  inside,
  loadNative,
  nodeLaunchOptions,
} from "./io.mjs";
import {
  decimal,
  identity,
  inspectionFromFacts,
  parseFacts,
  record,
  refuse,
  requireInspection,
} from "./facts.mjs";
import { candidateSession, parseCommand } from "./session.mjs";

const entry = fileURLToPath(import.meta.url);
const sourceRoot = resolve(dirname(entry), "../../..");
export const stableFixtureFiles = Object.freeze([
  "packages/contracts/src/runtime.ts",
  ...["facts", "fixture", "io", "session"].map(
    (name) => `probes/portable-primitives/experiment/${name}.mjs`,
  ),
]);
export const coordinatorPreconditions = Object.freeze([
  "Protected stable N owns these files and runtime.ts; retain and authenticate their complete exact byte census before execution.",
  "Authenticate candidate N+1, both build outputs, exact Node executable/ABI/architecture, headers, toolchain and source/flag census; hashes alone grant no trust.",
  "Create the exclusive root under provider runner.temp outside every source/build checkout; retain the same native-lock byte 41 and independently opened stable witness through all four rows.",
  "Perform native root/leaf identity and ancestor/reparse custody barriers, unlocked initial/final byte reads, and post-census module rehash; child metadata checks do not replace them.",
  "Own exact process handles, pending command/response matching, raw stdout/stderr, report event sequencing, all four case chronologies, negative controls and one 10000ms watchdog per row.",
  "HELD, clean/forced terminal interpretation, immediate one-attempt death acquisition, report reduction, archive/provider joins and hosted execution remain outside this foundation.",
]);

function configuration(value, guard) {
  const config = record(value, [
    "actor",
    "rootPath",
    "artifactRoot",
    "expectedIdentity",
    "candidate",
    "witness",
    "systemRoot",
    "stableFiles",
    "nativeHandle",
  ]);
  if (!["HOLDER", "CONTENDER", "DEFAULT_CHILD"].includes(config.actor)) refuse();
  absolute(config.rootPath);
  absolute(config.artifactRoot);
  if (
    inside(sourceRoot, config.rootPath) ||
    inside(sourceRoot, config.artifactRoot) ||
    inside(config.rootPath, sourceRoot) ||
    inside(config.artifactRoot, sourceRoot)
  )
    refuse();
  identity(config.expectedIdentity);
  if (!Array.isArray(config.stableFiles) || config.stableFiles.length !== stableFixtureFiles.length)
    refuse();
  for (const [i, path] of stableFixtureFiles.entries()) {
    const ref = record(config.stableFiles[i], ["path", "byteLength", "sha256"]);
    if (ref.path !== path) refuse();
    checkReference(guard, resolve(sourceRoot, path), ref);
  }
  guard.parents(config.rootPath);
  guard.metadata(config.rootPath, true);
  if (config.actor === "DEFAULT_CHILD") {
    if (config.candidate !== null) refuse();
    decimal(config.nativeHandle);
  } else if (config.candidate === null || config.nativeHandle !== null) refuse();
  nodeLaunchOptions(config.rootPath, config.systemRoot);
  return config;
}

// Stable callers get the actual ChildProcess handle. This function neither
// selects a PID nor treats a child's messages as witness/death authority.
export function spawnFixture(value) {
  const guard = fileGuard();
  const config = configuration(value, guard);
  if (config.actor === "DEFAULT_CHILD" && typeof process.send !== "function") refuse();
  guard.verify();
  return spawn(process.execPath, [entry], nodeLaunchOptions(config.rootPath, config.systemRoot));
}

async function main() {
  if (
    process.argv.length !== 2 ||
    process.execArgv.length !== 0 ||
    typeof process.send !== "function" ||
    !/^v24\./.test(process.version)
  )
    refuse();
  const guard = fileGuard();
  let config, witness, candidate, session, child, pending, childExit, childClose;
  let busy = false,
    failed = false,
    finished = false,
    spawned = false,
    previous = -1n;
  const childOutput = { stdout: [], stderr: [] };
  let outputLength = 0;
  let stopAfterReply = false;
  function deriveInspection(facts, nativeHandle) {
    try {
      return inspectionFromFacts(facts, nativeHandle);
    } catch {
      return null;
    } // Retain actual CALLs; missing inspection never means success.
  }
  const send = (value) =>
    new Promise((resolveSend, reject) =>
      process.send(value, (error) => (error ? reject(error) : resolveSend())),
    );
  function fail() {
    if (failed || finished) return;
    failed = true;
    if (child && !childClose) child.kill("SIGKILL"); // failure cleanup only; never an observation.
    process.exitCode = 1;
    if (process.connected) process.disconnect();
  }
  process.on("disconnect", () => {
    if (!finished) fail();
  });
  process.on("error", fail);
  function verify() {
    witness.verify();
    candidate?.verify();
    guard.verify();
  }
  function fixedMetadata() {
    const fixed = resolve(config.rootPath, "native-lock");
    guard.parents(fixed);
    if (guard.metadata(fixed, false).size !== 1n) refuse();
  }
  function exchange(command) {
    if (pending || childExit || childClose || !child.connected) refuse();
    return new Promise((resolveReply, reject) => {
      pending = { command, resolve: resolveReply, reject };
      child.send(command, (error) => {
        if (error) {
          reject(error);
          fail();
        }
      });
    });
  }
  async function spawnDefault(command) {
    if (config.actor !== "HOLDER" || session.state !== "LOCKED" || spawned) refuse();
    const facts = parseFacts(witness.addon.inspectNativeHandle(session.nativeHandle));
    const inspection = deriveInspection(facts, session.nativeHandle);
    try {
      requireInspection(inspection, config.expectedIdentity);
    } catch {
      stopAfterReply = true;
      return {
        sequence: command.sequence,
        name: command.name,
        holder: { facts, inspection },
        child: null,
      };
    }
    spawned = true;
    const childConfig = {
      ...config,
      actor: "DEFAULT_CHILD",
      candidate: null,
      nativeHandle: session.nativeHandle,
    };
    child = spawnFixture(childConfig);
    child.on("error", fail);
    for (const stream of ["stdout", "stderr"])
      child[stream].on("data", (bytes) => {
        outputLength += bytes.length;
        if (outputLength > 1024 * 1024) {
          fail();
          return;
        }
        childOutput[stream].push(bytes);
      });
    child.on("message", (value) => {
      try {
        if (!pending || pending.command.name !== "READY" || childExit || childClose) refuse();
        const reply = record(value, ["sequence", "name", "facts", "inspection"]);
        if (reply.sequence !== pending.command.sequence || reply.name !== "READY") refuse();
        const calls = parseFacts(reply.facts);
        const derived = deriveInspection(calls, session.nativeHandle);
        if (canonicalJson(reply.inspection) !== canonicalJson(derived)) refuse();
        const complete = pending;
        pending = null;
        complete.resolve({ ...reply, facts: calls, inspection: derived });
      } catch {
        pending?.reject(new Error("native-lock-fixture:refused"));
        fail();
      }
    });
    child.on("exit", (exitCode, signal) => {
      if (
        childExit ||
        !pending ||
        pending.command.name !== "CLOSE" ||
        exitCode !== 0 ||
        signal !== null
      ) {
        fail();
        return;
      }
      childExit = { exitCode: String(exitCode), signal };
    });
    child.on("disconnect", () => {
      if (!pending || pending.command.name !== "CLOSE") fail();
    });
    child.on("close", (exitCode, signal) => {
      if (
        childClose ||
        !childExit ||
        exitCode !== 0 ||
        signal !== null ||
        !pending ||
        pending.command.name !== "CLOSE"
      ) {
        fail();
        return;
      }
      childClose = { exitCode: String(exitCode), signal };
      const complete = pending;
      pending = null;
      complete.resolve({
        exit: childExit,
        close: childClose,
        stdoutBase64: Buffer.concat(childOutput.stdout).toString("base64"),
        stderrBase64: Buffer.concat(childOutput.stderr).toString("base64"),
      });
    });
    const reply = await exchange({
      sequence: command.sequence,
      name: "READY",
      configuration: childConfig,
    });
    try {
      requireInspection(reply.inspection, config.expectedIdentity, true);
    } catch {
      stopAfterReply = true;
    }
    return {
      sequence: command.sequence,
      name: command.name,
      holder: { facts, inspection },
      child: reply,
    };
  }
  process.on("message", async (value) => {
    if (busy || failed || finished) {
      fail();
      return;
    }
    busy = true;
    try {
      const command = parseCommand(value, !config);
      if (BigInt(command.sequence) <= previous) refuse();
      previous = BigInt(command.sequence);
      let reply;
      if (!config) {
        config = configuration(command.configuration, guard);
        witness = loadNative("STABLE_WITNESS", config.artifactRoot, config.witness, guard);
        if (config.actor === "DEFAULT_CHILD") {
          // No candidate reference and no openFixedLock/leaf read on this branch.
          const facts = parseFacts(witness.addon.inspectNativeHandle(config.nativeHandle));
          reply = {
            sequence: command.sequence,
            name: "READY",
            facts,
            inspection: deriveInspection(facts, config.nativeHandle),
          };
        } else {
          fixedMetadata();
          candidate = loadNative("CANDIDATE_BINDING", config.artifactRoot, config.candidate, guard);
          session = candidateSession(
            candidate.addon,
            resolve(config.rootPath, "native-lock"),
            config.expectedIdentity,
          );
          reply = session.run(command);
        }
      } else if (config.actor === "DEFAULT_CHILD") {
        if (command.name !== "CLOSE") refuse();
        verify();
        finished = true;
        process.disconnect();
        return;
      } else {
        fixedMetadata();
        if (command.name === "SPAWN_DEFAULT_CHILD") reply = await spawnDefault(command);
        else if (command.name === "CLOSE" && child && !childClose)
          reply = { sequence: command.sequence, name: "CLOSE", child: await exchange(command) };
        else {
          if (child && !childClose) refuse();
          reply = session.run(command);
        }
      }
      verify();
      if (failed) refuse();
      await send(reply);
      if (stopAfterReply || session?.state === "FAILED") fail();
      if (session?.state === "CLOSED") {
        finished = true;
        process.disconnect();
      }
    } catch {
      fail();
    } finally {
      busy = false;
    }
  });
}
if (process.argv[1] === entry)
  main().catch(() => {
    process.exitCode = 1;
    if (process.connected) process.disconnect();
  });
