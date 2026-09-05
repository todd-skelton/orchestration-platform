// Private setup/run/finalize seam. Protected stable N must authenticate the
// entire census before invoking this module. A hash supplied here grants no trust.
// No CLI, report serializer, profile selection, control census or provider join.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson } from "../../../packages/contracts/src/runtime.ts";
import { spawnFixture, stableFixtureFiles } from "./fixture.mjs";
import {
  absolute,
  checkReference,
  fileGuard,
  inside,
  loadNative,
  nodeLaunchOptions,
} from "./io.mjs";
import {
  identity,
  openOperations,
  parseCustodyResult,
  parseFacts,
  readOperations,
  record,
  refuse,
  requireCustody,
  requireLiveFacts,
  sameIdentity,
  successful,
} from "./facts.mjs";
import { captureProcess, measurement, retainCalls } from "./capture.mjs";

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
export const stableCaseFiles = Object.freeze([
  ...stableFixtureFiles,
  ...["capture", "case-context", "cases"].map(
    (name) => `probes/portable-primitives/experiment/${name}.mjs`,
  ),
]);
const contexts = new WeakSet();
export function requireCaseContext(value) {
  if (!contexts.has(value)) refuse();
  return value;
}

// The later stable control runner uses beginControl before beginCases, and the
// same custody/tryWitness/releaseWitness/spawn functions. No arbitrary fixture
// JSON may supply replacement code, native functions, loaders or observer facts.
export function createCaseContext(value) {
  const config = record(value, [
    "runnerTemp",
    "artifactRoot",
    "sourceRoots",
    "stableFiles",
    "candidate",
    "witness",
    "systemRoot",
  ]);
  absolute(config.runnerTemp);
  absolute(config.artifactRoot);
  if (
    typeof process.send === "function" ||
    process.execArgv.length !== 0 ||
    !/^v24\./.test(process.version)
  )
    refuse();
  if (!Array.isArray(config.sourceRoots) || !config.sourceRoots.includes(sourceRoot)) refuse();
  for (const root of config.sourceRoots) {
    absolute(root);
    for (const path of [config.runnerTemp, config.artifactRoot])
      if (inside(root, path) || inside(path, root)) refuse();
  }
  nodeLaunchOptions(config.runnerTemp, config.systemRoot);
  const guard = fileGuard();
  guard.parents(config.runnerTemp);
  guard.metadata(config.runnerTemp, true);
  guard.parents(config.artifactRoot);
  guard.metadata(config.artifactRoot, true);
  if (!Array.isArray(config.stableFiles) || config.stableFiles.length !== stableCaseFiles.length)
    refuse();
  function verify() {
    for (const [i, path] of stableCaseFiles.entries()) {
      if (config.stableFiles[i].path !== path) refuse();
      checkReference(guard, resolve(sourceRoot, path), config.stableFiles[i]);
    }
    checkReference(guard, resolve(config.artifactRoot, config.candidate.path), config.candidate);
    witness?.verify();
    guard.verify();
  }
  // Fix the candidate path before any reference can cause an arbitrary read.
  if (
    record(config.candidate, ["path", "byteLength", "sha256"]).path !==
    "builds/CANDIDATE_BINDING/native-lock-candidate.node"
  )
    refuse();
  let witness,
    handle = null,
    nativeHandle,
    leafIdentity,
    rootIdentity,
    locked = false;
  let setupDone = false,
    casesStarted = false,
    casesFinished = false,
    currentJournal = null,
    finalized = false,
    sequence = 0;
  const resources = [],
    setupCalls = [],
    cleanupFailures = [],
    retained = [];
  const rootPath = mkdtempSync(resolve(config.runnerTemp, "iss022-native-lock-"));
  if (inside(rootPath, config.artifactRoot) || inside(config.artifactRoot, rootPath)) refuse();
  const fixedPath = resolve(rootPath, "native-lock");
  writeFileSync(fixedPath, Buffer.from([0x41]), { flag: "wx", mode: 0o600 });
  const custody = {
    rootPath,
    leafName: "native-lock",
    initialIdentity: null,
    finalIdentity: null,
    initialByteHex: null,
    finalByteHex: null,
  };
  function calls(journal, value) {
    const facts = parseFacts(value);
    if (journal) retainCalls(journal, "PARENT", facts);
    else setupCalls.push(...facts);
    return facts;
  }
  function assertReady(journal) {
    if (!setupDone || finalized || casesFinished || (currentJournal && journal !== currentJournal))
      refuse();
    journal?.assert();
  }
  const context = Object.freeze({
    rootPath,
    fixedPath,
    artifactRoot: config.artifactRoot,
    custody,
    setupCalls,
    cleanupFailures,
    get identity() {
      return leafIdentity;
    },
    get nativeHandle() {
      return nativeHandle;
    },
    setup() {
      if (setupDone || witness || finalized) refuse();
      verify();
      guard.parents(fixedPath);
      guard.metadata(fixedPath, false);
      if (guard.bytes(fixedPath).toString("hex") !== "41") refuse();
      custody.initialByteHex = "41";
      witness = loadNative("STABLE_WITNESS", config.artifactRoot, config.witness, guard);
      const opened = witness.addon.openFixedLock(fixedPath);
      const facts = calls(null, opened.facts);
      handle = opened.handle;
      if (handle === null || facts.at(-1).identity === null) refuse();
      leafIdentity = identity(facts.at(-1).identity);
      nativeHandle = requireLiveFacts(facts, openOperations, leafIdentity);
      const root = parseCustodyResult(witness.addon.describeCustody());
      calls(null, root.facts);
      if (root.identity === null) refuse();
      rootIdentity = root.identity;
      custody.initialIdentity = leafIdentity;
      setupDone = true;
      this.barrier();
    },
    beginControl() {
      if (
        !setupDone ||
        casesStarted ||
        finalized ||
        locked ||
        (currentJournal && !currentJournal.isFrozen) ||
        resources.some((r) => !r.isClosed)
      )
        refuse();
      currentJournal = measurement();
      return currentJournal;
    },
    resetControl() {
      if (
        casesStarted ||
        finalized ||
        !currentJournal?.isFrozen ||
        resources.some((r) => !r.isClosed)
      )
        refuse();
      if (locked) {
        const facts = calls(null, witness.addon.release(handle));
        requireLiveFacts(facts, ["UNLOCK"], leafIdentity, nativeHandle);
        locked = false;
      }
    },
    beginCases() {
      if (
        !setupDone ||
        casesStarted ||
        finalized ||
        locked ||
        (currentJournal && !currentJournal.isFrozen) ||
        resources.some((r) => !r.isClosed)
      )
        refuse();
      casesStarted = true;
    },
    newCase() {
      if (
        !casesStarted ||
        casesFinished ||
        finalized ||
        locked ||
        (currentJournal && !currentJournal.isFrozen) ||
        resources.some((r) => !r.isClosed)
      )
        refuse();
      currentJournal = measurement(() => String(sequence++));
      return currentJournal;
    },
    endCases() {
      if (!casesStarted || casesFinished || !currentJournal?.isFrozen) refuse();
      casesFinished = true;
    },
    barrier(journal) {
      assertReady(journal);
      verify();
      guard.parents(fixedPath);
      const stat = guard.metadata(fixedPath, false);
      const root = parseCustodyResult(witness.addon.describeCustody());
      calls(journal, root.facts);
      const leaf = calls(journal, witness.addon.describe(handle));
      const data = {
        rootIdentity: root.identity,
        leafIdentity: leaf.at(-1).identity,
        regularFile: stat.isFile(),
        linkCount: String(stat.nlink),
        size: String(stat.size),
      };
      journal?.emit("PARENT", "CUSTODY", data);
      requireCustody(data, rootIdentity, leafIdentity);
      requireLiveFacts(leaf, readOperations, leafIdentity, nativeHandle);
      guard.verify();
      return data;
    },
    tryWitness(journal) {
      assertReady(journal);
      if (locked) refuse();
      // No custody, file read, await or retry is allowed ahead of this call.
      const raw = witness.addon.tryLock(handle);
      const facts = calls(journal, raw);
      if (facts.length === 1 && facts[0].operation === "TRY_LOCK" && successful(facts[0]))
        locked = true;
      return facts;
    },
    releaseWitness(journal) {
      assertReady(journal);
      if (!locked) refuse();
      const facts = calls(journal, witness.addon.release(handle));
      requireLiveFacts(facts, ["UNLOCK"], leafIdentity, nativeHandle);
      locked = false;
    },
    spawn(actor, journal) {
      assertReady(journal);
      if (!["HOLDER", "CONTENDER"].includes(actor)) refuse();
      const configuration = {
        actor,
        rootPath,
        artifactRoot: config.artifactRoot,
        expectedIdentity: leafIdentity,
        candidate: config.candidate,
        witness: config.witness,
        systemRoot: config.systemRoot,
        stableFiles: config.stableFiles.slice(0, stableFixtureFiles.length),
        nativeHandle: null,
      };
      const captured = captureProcess(spawnFixture(configuration), actor, journal);
      resources.push(captured);
      return { captured, configuration };
    },
    retain(caseId, actors, journal) {
      if (
        ![
          "NATIVE_UNRELATED_EXCLUSION",
          "NATIVE_NORMAL_RELEASE",
          "NATIVE_DEFAULT_NON_INHERITANCE",
          "NATIVE_HOLDER_DEATH_ONCE",
        ].includes(caseId) ||
        retained.some((entry) => entry.caseId === caseId)
      )
        refuse();
      if (caseId === "NATIVE_DEFAULT_NON_INHERITANCE" && !actors.DEFAULT_CHILD)
        cleanupFailures.push(
          "default-child capture unavailable; never synthesize empty child output",
        );
      retained.push({ caseId, actors, failures: journal.failures });
      return Object.freeze({ caseId, failures: journal.failures });
    },
    finalize() {
      if (finalized || (currentJournal && !currentJournal.isFrozen)) refuse();
      // runCases has spent only the remaining row watchdog on exact closure.
      // Preserve incomplete raw prefixes honestly; these cannot certify a row
      // or become complete captures merely because teardown eventually exits.
      if (resources.some((resource) => !resource.isClosed))
        cleanupFailures.push("known child close unobserved; captures incomplete");
      finalized = true;
      for (const { caseId, actors } of retained) {
        const directory = resolve(config.artifactRoot, "transcripts", caseId);
        mkdirSync(directory, { recursive: true });
        guard.parents(directory);
        guard.metadata(directory, true);
        for (const [actor, output] of Object.entries(actors)) {
          if (!["HOLDER", "CONTENDER", "DEFAULT_CHILD"].includes(actor)) refuse();
          for (const stream of ["stdout", "stderr"])
            writeFileSync(
              resolve(directory, `${actor}.${stream}`),
              Buffer.isBuffer(output[stream]) ? output[stream] : Buffer.concat(output[stream]),
              { flag: "wx" },
            );
        }
      }
      // Called after observations freeze. Do not acquire, retry, delete, or
      // replace the file. Known failed handles may only be released/closed.
      if (handle !== null) {
        try {
          if (locked) {
            const released = calls(null, witness.addon.release(handle));
            requireLiveFacts(released, ["UNLOCK"], leafIdentity, nativeHandle);
            locked = false;
          }
          const closing = handle;
          handle = null;
          const facts = calls(null, witness.addon.close(closing));
          if (facts.length !== 1 || facts[0].operation !== "CLOSE" || !facts.every(successful))
            refuse();
        } catch {
          cleanupFailures.push("witness cleanup failed");
        }
      }
      try {
        verify();
      } catch {
        cleanupFailures.push("final byte census changed");
      }
      writeFileSync(
        resolve(config.artifactRoot, "case-diagnostics.json"),
        canonicalJson({
          setupCalls,
          cleanupFailures,
          custody,
          captures: retained.map(({ caseId, actors, failures }) => ({
            caseId,
            failures,
            actors: Object.entries(actors).map(([actor, output]) => ({
              actor,
              commands: output.commands ?? null,
              replies: output.replies ?? null,
              terminals: output.terminals ?? null,
              truncated: output.truncated ?? false,
            })),
          })),
        }),
        { flag: "wx" },
      );
      return Object.freeze({
        cleanupFailures: Object.freeze(cleanupFailures),
        custody: Object.freeze(custody),
      });
    },
    finishCustody(journal) {
      assertReady(journal);
      if (locked || resources.some((r) => !r.isClosed)) refuse();
      const final = this.barrier(journal);
      const bytes = guard.bytes(fixedPath).toString("hex");
      if (bytes !== "41" || !sameIdentity(final.leafIdentity, leafIdentity)) refuse();
      custody.finalIdentity = final.leafIdentity;
      custody.finalByteHex = bytes;
    },
  });
  contexts.add(context);
  return context;
}
