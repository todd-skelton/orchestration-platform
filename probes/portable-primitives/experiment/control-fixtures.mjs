// Private ISS-048 stage-three control-phase call-interception fixtures
// (sub-slice 3.3). These three stable-authored JavaScript fixtures stand in for
// a hostile candidate on the ledger's first three control rows: `BYPASS_LOCK`,
// `PREMATURE_UNLOCK` and `RETAIN_AFTER_RELEASE`. They add no native binary and
// no alternate candidate: each child loads only the already built
// `STABLE_WITNESS` addon through the landed `loadNative` guard and takes real
// locks on the one fixed file. No candidate addon is loaded here, and none is
// ever loaded in the stable parent. No fixture spawns a further child, issues a
// death, termination or inheritance command, or runs a case: there is no second
// holder-death attempt anywhere in this module, and the death case is never
// repeated to find a favourable result.
//
// A fixture's own report is a claim, never evidence. `judgeNativeLockControlFixture`
// takes the control ID and the stable parent's own witness facts and nothing
// else, so no code path can reach a verdict from what the fixture said about
// itself; the claim is retained only as replayable control input.
//
// This module must stay loadable by bare Node, because it is the entry of a
// spawned bare-Node child. It therefore imports only `node:` builtins and the
// landed `./facts.mjs` and `./io.mjs`, and it must never import
// `./controls.mjs`, `scripts/conformance/*.mts` or `packages/conformance/src`,
// whose graphs resolve only under esbuild or Vitest.
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  identity,
  lockDisposition,
  openOperations,
  operationsAre,
  parseFacts,
  record,
  refuse,
  requireLiveFacts,
  successful,
} from "./facts.mjs";
import {
  absolute,
  checkReference,
  fileGuard,
  inside,
  loadNative,
  nodeLaunchOptions,
} from "./io.mjs";

const entry = fileURLToPath(import.meta.url);
const sourceRoot = resolve(dirname(entry), "../../..");

/** The exact stable byte census a control-fixture child authenticates. */
export const stableControlFixtureFiles = Object.freeze([
  "packages/contracts/src/runtime.ts",
  "probes/portable-primitives/experiment/control-fixtures.mjs",
  "probes/portable-primitives/experiment/facts.mjs",
  "probes/portable-primitives/experiment/io.mjs",
]);

/** The only two commands a control fixture ever exchanges. */
export const nativeLockControlFixtureCommands = Object.freeze(["READY", "CLOSE"]);

/**
 * Commands that would start a second holder-death or an inheritance run. No
 * control fixture may declare one; `checkNativeLockControlDeathFreedom` refuses.
 */
export const nativeLockControlDeathCommands = Object.freeze(["SPAWN_DEFAULT_CHILD", "TERMINATE"]);

/** The closed claim record a fixture child reports about itself. */
export const nativeLockControlFixtureClaimFields = Object.freeze([
  "controlId",
  "detail",
  "heldClaim",
  "releasedClaim",
  "state",
]);

/**
 * The three fixtures in the ledger's census order. `refutingDisposition` is the
 * stable parent's own witness outcome that contradicts the claim, and
 * `corroboratingDisposition` is the outcome under which the false claim would
 * stand. Neither is read from the fixture.
 */
export const nativeLockControlFixturePolicies = Object.freeze([
  Object.freeze({
    claim: "ACQUIRED_WITHOUT_CALLING_THE_LOCK",
    commands: nativeLockControlFixtureCommands,
    controlId: "BYPASS_LOCK",
    corroboratingDisposition: "CONTENDED",
    interception: "tryLock:never-called-while-claiming-acquisition",
    refutingDisposition: "ACQUIRED",
  }),
  Object.freeze({
    claim: "STILL_HELD_AFTER_AN_UNCOMMANDED_UNLOCK",
    commands: nativeLockControlFixtureCommands,
    controlId: "PREMATURE_UNLOCK",
    corroboratingDisposition: "CONTENDED",
    interception: "release:issued-before-any-parent-release-or-death-command",
    refutingDisposition: "ACQUIRED",
  }),
  Object.freeze({
    claim: "RELEASED_WHILE_RETAINING_THE_LOCK",
    commands: nativeLockControlFixtureCommands,
    controlId: "RETAIN_AFTER_RELEASE",
    corroboratingDisposition: "ACQUIRED",
    interception: "release:never-called-while-claiming-release",
    refutingDisposition: "CONTENDED",
  }),
]);

const brief = (value) => String(value).slice(0, 240);

/** The fixture policy for one control ID. Never derived from a caller's table. */
export function nativeLockControlFixturePolicy(controlId) {
  const policy = nativeLockControlFixturePolicies.find((row) => row.controlId === controlId);
  if (!policy) refuse();
  return policy;
}

/**
 * Gate: the fixture table must be exactly the landed control ID list's first
 * three rows, in that order, and may declare only the two closed commands. A
 * reordered, renamed, short or extended table refuses instead of silently
 * re-associating a fixture with another control.
 */
export function checkNativeLockControlFixtureCensus(policies, expectedControlIds) {
  if (
    !Array.isArray(policies) ||
    !Array.isArray(expectedControlIds) ||
    policies.length !== expectedControlIds.length ||
    policies.length === 0
  )
    refuse();
  for (const [index, policy] of policies.entries()) {
    if (!policy || policy.controlId !== expectedControlIds[index]) refuse();
    if (!Array.isArray(policy.commands) || policy.commands.length === 0) refuse();
    for (const name of policy.commands)
      if (!nativeLockControlFixtureCommands.includes(name)) refuse();
  }
  return Object.freeze(policies.map((policy) => policy.controlId));
}

/**
 * Gate: no control may run a holder-death or inheritance attempt. No fixture
 * declares a death or spawn command and the control phase never calls the
 * seam's case-actor spawn, so `spawnCount` must still be zero.
 */
export function checkNativeLockControlDeathFreedom(policies, spawnCount) {
  if (!Array.isArray(policies) || !Number.isInteger(spawnCount) || spawnCount !== 0) refuse();
  for (const policy of policies) {
    if (!policy || !Array.isArray(policy.commands)) refuse();
    for (const name of policy.commands) if (nativeLockControlDeathCommands.includes(name)) refuse();
  }
  return true;
}

/**
 * Judge one fixture row. The only inputs are the control ID and the stable
 * parent's own witness facts, reduced by the landed `lockDisposition`. There is
 * deliberately no parameter for the fixture's report, so the claim cannot reach
 * a verdict. A disposition that is neither the refuting nor the corroborating
 * one yields a null verdict and the caller falls back to the same stable
 * prerequisite derivation the report carries.
 */
export function judgeNativeLockControlFixture(controlId, witnessFacts) {
  const policy = nativeLockControlFixturePolicy(controlId);
  const disposition = lockDisposition(witnessFacts);
  return Object.freeze({
    disposition,
    verdict:
      disposition === policy.refutingDisposition
        ? "REFUSED"
        : disposition === policy.corroboratingDisposition
          ? "VIOLATED"
          : null,
  });
}

/** A named ledger of the resources one fixture opened on the fixed file. */
export function createNativeLockControlResourceLedger() {
  const open = new Set();
  return Object.freeze({
    open(name) {
      if (typeof name !== "string" || name.length === 0 || open.has(name)) refuse();
      open.add(name);
      return name;
    },
    close(name) {
      if (!open.has(name)) refuse();
      open.delete(name);
      return name;
    },
    get openNames() {
      return Object.freeze([...open].sort());
    },
  });
}

/**
 * Gate: the control reset refuses while any known resource is still open or the
 * control journal is not frozen. It runs before the landed seam's own
 * `resetControl`, which repeats both conditions over its private state.
 */
export function checkNativeLockControlReset(ledger, journal) {
  const names = ledger?.openNames;
  if (!Array.isArray(names) || names.length !== 0) refuse();
  if (journal !== null && journal !== undefined && journal.isFrozen !== true) refuse();
  return true;
}

/**
 * Gate: the case phase refuses when a control left the witness locked or left a
 * resource open on the fixed file.
 */
export function checkNativeLockCasePhaseEntry(phase) {
  const parsed = record(phase, ["openResources", "witnessHeld"]);
  if (parsed.witnessHeld !== false) refuse();
  if (!Array.isArray(parsed.openResources) || parsed.openResources.length !== 0) refuse();
  return true;
}

function controlFixtureConfiguration(value, guard) {
  const config = record(value, [
    "artifactRoot",
    "controlId",
    "expectedIdentity",
    "rootPath",
    "stableFiles",
    "systemRoot",
    "witness",
  ]);
  nativeLockControlFixturePolicy(config.controlId);
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
  if (
    !Array.isArray(config.stableFiles) ||
    config.stableFiles.length !== stableControlFixtureFiles.length
  )
    refuse();
  for (const [index, path] of stableControlFixtureFiles.entries()) {
    const reference = record(config.stableFiles[index], ["path", "byteLength", "sha256"]);
    if (reference.path !== path) refuse();
    checkReference(guard, resolve(sourceRoot, path), reference);
  }
  guard.parents(config.rootPath);
  guard.metadata(config.rootPath, true);
  nodeLaunchOptions(config.rootPath, config.systemRoot);
  return config;
}

/**
 * Spawn one control-fixture child under bare Node. The child loads only the
 * stable witness; it is handed no candidate reference, no extra stdio and no
 * inherited environment. Stable callers get the actual ChildProcess handle.
 */
export function spawnNativeLockControlFixture(value) {
  const guard = fileGuard();
  const config = controlFixtureConfiguration(value, guard);
  guard.verify();
  return spawn(process.execPath, [entry], nodeLaunchOptions(config.rootPath, config.systemRoot));
}

// ---------------------------------------------------------------------------
// Child side. Reached only from a spawned bare-Node child of the hosted control
// phase; every function below runs with the stable witness addon and never with
// a candidate, a synthetic addon or an injected loader.
// ---------------------------------------------------------------------------

function openWitnessHandle(addon, fixedPath, expectedIdentity) {
  const opened = addon.openFixedLock(fixedPath);
  if (!opened || typeof opened !== "object" || Object.getPrototypeOf(opened) !== Object.prototype)
    refuse();
  const fields = Object.getOwnPropertyDescriptors(opened);
  if (
    Reflect.ownKeys(fields).length !== 2 ||
    !fields.handle?.enumerable ||
    !fields.facts?.enumerable ||
    !("value" in fields.handle) ||
    !("value" in fields.facts)
  )
    refuse();
  const facts = parseFacts(fields.facts.value);
  const handle = fields.handle.value;
  if (handle === null || typeof handle !== "object") refuse();
  return Object.freeze({
    handle,
    nativeHandle: requireLiveFacts(facts, openOperations, expectedIdentity),
  });
}

function claimOf(policy, state, heldClaim, releasedClaim, detail) {
  return Object.freeze({
    controlId: policy.controlId,
    detail,
    heldClaim,
    releasedClaim,
    state,
  });
}

/**
 * Apply one fixture's interception policy against the stable witness on the one
 * fixed file, and report the deliberately false claim it is authored to make.
 * The claim is retained as control input; the stable parent judges only its own
 * witness call.
 */
export function runControlFixturePolicy(policy, addon, fixedPath, expectedIdentity) {
  nativeLockControlFixturePolicy(policy.controlId);
  const opened = openWitnessHandle(addon, fixedPath, expectedIdentity);
  let held = false;
  let closed = false;
  function unlock() {
    const facts = parseFacts(addon.release(opened.handle));
    if (!operationsAre(facts, ["UNLOCK"]) || !facts.every(successful)) refuse();
    requireLiveFacts(facts, ["UNLOCK"], expectedIdentity, opened.nativeHandle);
    held = false;
  }
  let claim;
  if (policy.controlId === "BYPASS_LOCK") {
    // The lock call is intercepted away entirely: nothing is ever attempted on
    // the fixed file, and the fixture still claims to hold it.
    claim = claimOf(policy, "LOCKED", true, false, policy.interception);
  } else {
    const facts = parseFacts(addon.tryLock(opened.handle));
    const disposition = lockDisposition(facts);
    if (disposition !== "ACQUIRED")
      claim = claimOf(policy, disposition, false, false, `witness-unavailable:${disposition}`);
    else {
      held = true;
      if (policy.controlId === "PREMATURE_UNLOCK") {
        unlock();
        // Unlocked with no parent release or death command, still claiming to hold.
        claim = claimOf(policy, "LOCKED", true, false, policy.interception);
      } else {
        // Release is intercepted away: the claim says released, the lock is kept.
        claim = claimOf(policy, "OPEN", false, true, policy.interception);
      }
    }
  }
  return Object.freeze({
    claim,
    close() {
      if (closed) refuse();
      closed = true;
      if (held) unlock();
      const facts = parseFacts(addon.close(opened.handle));
      if (!operationsAre(facts, ["CLOSE"]) || !facts.every(successful)) refuse();
    },
    get held() {
      return held;
    },
  });
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
  let config = null;
  let witness = null;
  let running = null;
  let busy = false;
  let finished = false;
  const send = (value) =>
    new Promise((resolveSend, reject) =>
      process.send(value, (error) => (error ? reject(error) : resolveSend())),
    );
  function fail() {
    if (finished) return;
    finished = true;
    process.exitCode = 1;
    if (process.connected) process.disconnect();
  }
  process.on("disconnect", () => {
    if (!finished) fail();
  });
  process.on("error", fail);
  process.on("message", async (value) => {
    if (busy || finished) {
      fail();
      return;
    }
    busy = true;
    try {
      const command = record(
        value,
        config ? ["sequence", "name"] : ["sequence", "name", "configuration"],
      );
      if (!nativeLockControlFixtureCommands.includes(command.name)) refuse();
      if (!config) {
        if (command.name !== "READY") refuse();
        config = controlFixtureConfiguration(command.configuration, guard);
        const fixedPath = resolve(config.rootPath, "native-lock");
        guard.parents(fixedPath);
        if (guard.metadata(fixedPath, false).size !== 1n) refuse();
        witness = loadNative("STABLE_WITNESS", config.artifactRoot, config.witness, guard);
        running = runControlFixturePolicy(
          nativeLockControlFixturePolicy(config.controlId),
          witness.addon,
          fixedPath,
          config.expectedIdentity,
        );
        witness.verify();
        guard.verify();
        await send({
          claim: running.claim,
          controlId: config.controlId,
          interception: nativeLockControlFixturePolicy(config.controlId).interception,
          name: "READY",
          sequence: command.sequence,
        });
      } else {
        if (command.name !== "CLOSE") refuse();
        running.close();
        witness.verify();
        guard.verify();
        finished = true;
        await send({
          claim: running.claim,
          controlId: config.controlId,
          interception: nativeLockControlFixturePolicy(config.controlId).interception,
          name: "CLOSE",
          sequence: command.sequence,
        });
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

// ---------------------------------------------------------------------------
// Parent side. Drives one fixture child through the landed control-phase seam.
// ---------------------------------------------------------------------------

/** The bounded per-fixture watchdog, the same 10000 ms the landed rows use. */
export const nativeLockControlFixtureWatchdogMs = 10_000;

function once(child, event, watchdogMs, predicate = () => true) {
  return new Promise((resolveOnce, reject) => {
    let done = false;
    const finish = (error, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      child.off?.(event, onEvent);
      child.off?.("error", onError);
      if (error) reject(error);
      else resolveOnce(value);
    };
    // Never unref: a hung exchange must reach the watchdog, not let the process
    // exit with the row silently unresolved.
    const timer = setTimeout(
      () => finish(new Error("native-lock-control-fixture:watchdog")),
      watchdogMs,
    );
    const onEvent = (value) => {
      if (predicate(value)) finish(null, value);
    };
    const onError = () => finish(new Error("native-lock-control-fixture:child-error"));
    child.on(event, onEvent);
    child.on("error", onError);
  });
}

function exchangeWithChild(child, message, watchdogMs) {
  const reply = once(child, "message", watchdogMs);
  child.send(message, () => {});
  return reply;
}

function parseFixtureReply(value, policy, sequence, name) {
  const reply = record(value, ["claim", "controlId", "interception", "name", "sequence"]);
  if (reply.controlId !== policy.controlId || reply.name !== name || reply.sequence !== sequence)
    refuse();
  const claim = record(reply.claim, nativeLockControlFixtureClaimFields);
  if (claim.controlId !== policy.controlId) refuse();
  return Object.freeze({ claim, interception: reply.interception });
}

/**
 * Run one fixture child end to end: spawn it, take its claim, make the stable
 * parent's own witness call through the seam, then close the child and its
 * known resource on the fixed file before the next fixture. Nothing here reads
 * the claim: the witness facts are returned separately and judged by
 * `judgeNativeLockControlFixture`.
 */
export async function runNativeLockControlFixtureChild(policy, seam, boundary) {
  const spawnChild = boundary.spawn ?? spawnNativeLockControlFixture;
  const watchdogMs = boundary.watchdogMs ?? nativeLockControlFixtureWatchdogMs;
  const ledger = boundary.ledger ?? createNativeLockControlResourceLedger();
  const resource = `${policy.controlId}:child`;
  let journal = null;
  let child = null;
  let claim = null;
  let interception = null;
  let witnessFacts = null;
  let failure = null;
  try {
    journal = seam.beginControl();
    child = spawnChild({
      artifactRoot: seam.artifactRoot,
      controlId: policy.controlId,
      expectedIdentity: seam.identity,
      rootPath: seam.rootPath,
      stableFiles: boundary.fixtureChild.stableFiles,
      systemRoot: boundary.fixtureChild.systemRoot,
      witness: boundary.fixtureChild.witness,
    });
    ledger.open(resource);
    const ready = parseFixtureReply(
      await exchangeWithChild(child, { name: "READY", sequence: "0" }, watchdogMs),
      policy,
      "0",
      "READY",
    );
    claim = ready.claim;
    interception = ready.interception;
    seam.barrier(journal);
    witnessFacts = seam.tryWitness(journal);
  } catch (error) {
    failure = brief(error?.message ?? error);
  }
  try {
    if (child !== null) {
      parseFixtureReply(
        await exchangeWithChild(child, { name: "CLOSE", sequence: "1" }, watchdogMs),
        policy,
        "1",
        "CLOSE",
      );
      await once(child, "close", watchdogMs);
      ledger.close(resource);
    }
  } catch (error) {
    // A child that never closes is left alone: signalling it would be a second
    // holder-death attempt hidden in a control. Its resource stays open in the
    // ledger, the reset gate refuses, and the case phase stays closed.
    failure ??= brief(error?.message ?? error);
  }
  if (journal !== null && !journal.isFrozen) journal.freeze();
  return Object.freeze({
    claim,
    controlId: policy.controlId,
    failure,
    interception,
    journal,
    ledger,
    witnessFacts,
  });
}
