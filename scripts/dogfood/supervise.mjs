import { realpathSync, writeFileSync } from "node:fs";
import { readFile, realpath } from "node:fs/promises";
import { delimiter, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  currentCandidateAttempt,
  DeliveryBlocked,
  hasStartedDelivery,
  queueConfigFromLoop,
  QueueBlocked,
  queueStep,
  repositoryQueueAdapter,
  retainedPostMergeDelivery,
  validateLoopExecutor,
  validateLoopConfig,
} from "./queue.ts";
import {
  completeCycle,
  nextCycle,
  persistCycle,
  reconcilePendingStop,
  repositorySupervisionAdapter,
  startCycle,
  stopCycle,
} from "./supervision.ts";
import { loadRepositoryAdapter } from "./repository-adapter.mjs";
import { codexAdapter } from "./dispatch-adapter.ts";

// ISS-164: the private request stream between the attached Windows parent and
// this supervisor. stdout carries status lines and requests; stdin carries
// replies. One run, one pending correlation, closed v1 shapes.
export const NATIVE_DB_REQUEST_SCHEMA = "dogfood-native-db-request/v1";
export const NATIVE_DB_REPLY_SCHEMA = "dogfood-native-db-reply/v1";
export const NATIVE_DB_PROFILE = "reconciliation-pg16/v1";
export const NATIVE_DB_REQUEST_LIMIT = 65536;
export const NATIVE_DB_REPLY_LIMIT = 8192;
export const NATIVE_DB_REQUEST_KEYS = Object.freeze([
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
]);
export const NATIVE_DB_REPLY_KEYS = Object.freeze([
  "schemaVersion",
  "correlation",
  "status",
  "owner",
  "evidencePath",
  "diagnostic",
]);
const NATIVE_DB_REPLY_STATUSES = Object.freeze(["completed", "refused", "unknown"]);
const ID = /^[A-Za-z0-9._:-]{1,128}$/;
const REPOSITORY_SEGMENT = /^[A-Za-z0-9._-]{1,100}$/;
const GIT_REVISION = /^[0-9a-f]{40}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const LOCK_ID = /^[0-9a-f]{32}$/;
const ABSOLUTE_ROOT = /^(?:[A-Za-z]:[\\/]|\\\\|\/)/;

const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
// Every object is closed: exactly the named keys, nothing else.
function closed(value, keys, path) {
  if (!isObject(value)) return `${path} must be an object`;
  const present = Object.keys(value);
  for (const key of keys) if (!present.includes(key)) return `${path}.${key} is required`;
  for (const key of present) if (!keys.includes(key)) return `${path}.${key} is not a v1 key`;
  return undefined;
}
function text(value, minimum, maximum, path, pattern) {
  if (typeof value !== "string") return `${path} must be a string`;
  if (value.length < minimum || value.length > maximum)
    return `${path} must be ${minimum}..${maximum} characters`;
  if (pattern && !pattern.test(value)) return `${path} has an unsupported shape`;
  return undefined;
}
function integer(value, minimum, maximum, path) {
  if (!Number.isSafeInteger(value)) return `${path} must be a safe integer`;
  if (value < minimum || value > maximum) return `${path} must be ${minimum}..${maximum}`;
  return undefined;
}
function segments(value) {
  return value.split(/[\\/]/);
}
// Absolute, normalized, no traversal; containment is the caller's parent list.
function absolutePath(value, path, approvedParents) {
  const shape = text(value, 1, 1024, path);
  if (shape) return shape;
  if (!ABSOLUTE_ROOT.test(value) || value.includes("\0")) return `${path} must be absolute`;
  const body = value.replace(ABSOLUTE_ROOT, "");
  if (body.length > 0 && segments(body).some((segment) => ["", ".", ".."].includes(segment)))
    return `${path} must be normalized without traversal`;
  if (
    approvedParents &&
    !approvedParents.some(
      (parent) =>
        value.length > parent.length + 1 &&
        value.startsWith(parent) &&
        /[\\/]/.test(value[parent.length]),
    )
  )
    return `${path} is not under an approved parent`;
  return undefined;
}
function relativePath(value, path) {
  const shape = text(value, 1, 1024, path);
  if (shape) return shape;
  if (
    ABSOLUTE_ROOT.test(value) ||
    value.includes("\\") ||
    value.includes(":") ||
    value.includes("\0") ||
    value.split("/").some((segment) => ["", ".", ".."].includes(segment))
  )
    return `${path} must be a relative path without traversal`;
  return undefined;
}
function list(value, minimum, maximum, path, item, identity) {
  if (!Array.isArray(value)) return `${path} must be a list`;
  if (value.length < minimum || value.length > maximum)
    return `${path} must have ${minimum}..${maximum} entries`;
  const seen = new Set();
  for (const [index, entry] of value.entries()) {
    const diagnostic = item(entry, `${path}[${index}]`);
    if (diagnostic) return diagnostic;
    const key = identity(entry);
    if (seen.has(key)) return `${path} repeats ${JSON.stringify(key)}`;
    seen.add(key);
  }
  return undefined;
}
const cases = (value, path) =>
  list(
    value,
    1,
    256,
    path,
    (entry, entryPath) => text(entry, 1, 512, entryPath),
    (entry) => entry,
  );
function fileEntry(value, path) {
  return (
    closed(value, ["file", "cases"], path) ??
    relativePath(value.file, `${path}.file`) ??
    cases(value.cases, `${path}.cases`)
  );
}
function mutant(value, path) {
  return (
    closed(value, ["id", "file", "cases", "assertion"], path) ??
    text(value.id, 1, 128, `${path}.id`, ID) ??
    relativePath(value.file, `${path}.file`) ??
    cases(value.cases, `${path}.cases`) ??
    text(value.assertion, 1, 2048, `${path}.assertion`)
  );
}
function patchDigest(value, path) {
  return (
    closed(value, ["id", "digest"], path) ??
    text(value.id, 1, 128, `${path}.id`, ID) ??
    text(value.digest, 64, 64, `${path}.digest`, DIGEST)
  );
}
function repository(value, path) {
  const shape = text(value, 3, 201, path);
  if (shape) return shape;
  const parts = value.split("/");
  if (parts.length !== 2 || parts.some((part) => !REPOSITORY_SEGMENT.test(part)))
    return `${path} must be owner/name`;
  return undefined;
}

// Returns the first diagnostic, or undefined for an accepted v1 request.
export function validateNativeDbRequest(value, { run, approvedParents = [] } = {}) {
  const diagnostic =
    closed(value, NATIVE_DB_REQUEST_KEYS, "request") ??
    (value.schemaVersion === NATIVE_DB_REQUEST_SCHEMA
      ? undefined
      : `request.schemaVersion must be ${NATIVE_DB_REQUEST_SCHEMA}`) ??
    integer(value.correlation, 1, Number.MAX_SAFE_INTEGER, "request.correlation") ??
    (value.profile === NATIVE_DB_PROFILE
      ? undefined
      : `request.profile must be ${NATIVE_DB_PROFILE}`) ??
    text(value.run, 1, 128, "request.run", ID) ??
    (run === undefined || value.run === run ? undefined : "request.run is not the bound run") ??
    integer(value.issue, 1, 2147483647, "request.issue") ??
    integer(value.attempt, 1, 2147483647, "request.attempt") ??
    text(value.executorHead, 40, 40, "request.executorHead", GIT_REVISION) ??
    closed(value.product, ["repository", "head", "tree"], "request.product") ??
    repository(value.product.repository, "request.product.repository") ??
    text(value.product.head, 40, 40, "request.product.head", GIT_REVISION) ??
    text(value.product.tree, 40, 40, "request.product.tree", GIT_REVISION) ??
    closed(value.declaration, ["version", "profile", "files", "mutants"], "request.declaration") ??
    (value.declaration.version === 1 ? undefined : "request.declaration.version must be 1") ??
    (value.declaration.profile === NATIVE_DB_PROFILE
      ? undefined
      : `request.declaration.profile must be ${NATIVE_DB_PROFILE}`) ??
    list(value.declaration.files, 3, 3, "request.declaration.files", fileEntry, (e) => e.file) ??
    list(value.declaration.mutants, 0, 3, "request.declaration.mutants", mutant, (e) => e.id) ??
    list(value.patchDigests, 0, 3, "request.patchDigests", patchDigest, (e) => e.id) ??
    absolutePath(value.stagedInputDirectory, "request.stagedInputDirectory", approvedParents);
  if (diagnostic) return diagnostic;
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > NATIVE_DB_REQUEST_LIMIT)
    return `request exceeds ${NATIVE_DB_REQUEST_LIMIT} UTF-8 bytes`;
  return undefined;
}

// Returns the first diagnostic, or undefined for an accepted v1 reply.
export function validateNativeDbReply(value) {
  const diagnostic =
    closed(value, NATIVE_DB_REPLY_KEYS, "reply") ??
    (value.schemaVersion === NATIVE_DB_REPLY_SCHEMA
      ? undefined
      : `reply.schemaVersion must be ${NATIVE_DB_REPLY_SCHEMA}`) ??
    integer(value.correlation, 1, Number.MAX_SAFE_INTEGER, "reply.correlation") ??
    (NATIVE_DB_REPLY_STATUSES.includes(value.status)
      ? undefined
      : "reply.status must be completed, refused or unknown") ??
    (value.owner === null
      ? undefined
      : (closed(value.owner, ["lockId", "head", "lane"], "reply.owner") ??
        text(value.owner.lockId, 32, 32, "reply.owner.lockId", LOCK_ID) ??
        text(value.owner.head, 40, 40, "reply.owner.head", GIT_REVISION) ??
        text(value.owner.lane, 1, 128, "reply.owner.lane", ID))) ??
    (value.evidencePath === null
      ? undefined
      : absolutePath(value.evidencePath, "reply.evidencePath")) ??
    (value.diagnostic === null ? undefined : text(value.diagnostic, 1, 2048, "reply.diagnostic"));
  if (diagnostic) return diagnostic;
  if (value.status === "completed" && (value.owner === null || value.evidencePath === null))
    return "reply.status completed requires owner and evidencePath";
  if (value.status !== "completed" && (value.owner !== null || value.evidencePath !== null))
    return `reply.status ${value.status} carries no owner or evidencePath`;
  if (value.status !== "completed" && value.diagnostic === null)
    return `reply.status ${value.status} requires a diagnostic`;
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > NATIVE_DB_REPLY_LIMIT)
    return `reply exceeds ${NATIVE_DB_REPLY_LIMIT} UTF-8 bytes`;
  return undefined;
}

// One channel per process. `request` resolves to a typed lifecycle result:
// completed, refused or unknown, never a PASS. Local refusals never reach the
// stream; anything after the request left the process resolves unknown.
export function createNativeDbAdmission(run, input, output, { approvedParents = [] } = {}) {
  let correlation = 0;
  let pending;
  let ended = false;
  let buffer = "";
  const result = (status, diagnostic, extra = {}) => ({
    correlation: null,
    status,
    owner: null,
    evidencePath: null,
    diagnostic,
    ...extra,
  });
  const settle = (value) => {
    const current = pending;
    pending = undefined;
    current?.settle(value);
  };
  const unknown = (diagnostic) =>
    settle(result("unknown", diagnostic, { correlation: pending.correlation }));
  const receive = (line) => {
    if (!pending) return;
    if (Buffer.byteLength(line, "utf8") > NATIVE_DB_REPLY_LIMIT)
      return unknown(`native-db-reply-oversize: ${NATIVE_DB_REPLY_LIMIT} bytes`);
    let reply;
    try {
      reply = JSON.parse(line);
    } catch {
      return unknown("native-db-reply-malformed");
    }
    const diagnostic = validateNativeDbReply(reply);
    if (diagnostic) return unknown(`native-db-reply-invalid: ${diagnostic}`);
    // Another correlation is not this request's reply.
    if (reply.correlation !== pending.correlation) return;
    settle({
      correlation: reply.correlation,
      status: reply.status,
      owner: reply.owner,
      evidencePath: reply.evidencePath,
      diagnostic: reply.diagnostic,
    });
  };
  const onData = (chunk) => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, index).replace(/\r$/, "");
      buffer = buffer.slice(index + 1);
      receive(line);
    }
    if (pending && Buffer.byteLength(buffer, "utf8") > NATIVE_DB_REPLY_LIMIT) {
      buffer = "";
      unknown(`native-db-reply-oversize: ${NATIVE_DB_REPLY_LIMIT} bytes`);
    }
  };
  const onEnd = () => {
    if (ended) return;
    ended = true;
    detach();
    if (pending) unknown("native-db-channel-closed");
  };
  const detach = () => {
    input.off("data", onData);
    input.off("end", onEnd);
    input.off("close", onEnd);
    input.off("error", onEnd);
    input.pause();
  };
  input.setEncoding("utf8");
  input.on("data", onData);
  input.on("end", onEnd);
  input.on("close", onEnd);
  input.on("error", onEnd);
  return {
    request(body) {
      if (ended) return Promise.resolve(result("refused", "native-db-channel-closed"));
      if (pending) return Promise.resolve(result("refused", "native-db-request-pending"));
      // The channel owns the schema and the correlation; the caller supplies the rest.
      const request = {
        ...(isObject(body) ? body : {}),
        schemaVersion: NATIVE_DB_REQUEST_SCHEMA,
        correlation: correlation + 1,
      };
      const diagnostic = validateNativeDbRequest(request, { run, approvedParents });
      if (diagnostic)
        return Promise.resolve(result("refused", `native-db-request-invalid: ${diagnostic}`));
      correlation = request.correlation;
      return new Promise((settleRequest) => {
        pending = { correlation: request.correlation, settle: settleRequest };
        output.write(`${JSON.stringify(request)}\n`, (error) => {
          if (error && pending?.correlation === request.correlation)
            unknown(`native-db-channel-write-failed: ${error.message}`);
        });
      });
    },
    close() {
      onEnd();
    },
  };
}

// ISS-165: the queue's native adapter carries the run-owned channel as the
// optional typed `nativeDbProfile` method; every existing spread (`...native`)
// keeps it. Main binds the method here and still never requests.
export function nativeDbProfileAdapter(native, channel) {
  return { ...native, nativeDbProfile: (identity) => channel.request(identity) };
}

let active;
let config;
let loop;
let validatedExecutor;
let repositoryAdapter;
let queueAdapter;
let supervisor;

function blocked(error, lifecycleReason) {
  const reason = error instanceof QueueBlocked ? error.reason : "queue-internal-error";
  const diagnostics =
    error instanceof QueueBlocked
      ? error.diagnostics
      : error instanceof Error
        ? error.message
        : String(error);
  writeFileSync(
    process.stderr.fd,
    `${JSON.stringify({
      status: "blocked",
      reason,
      ...(diagnostics ? { diagnostics } : {}),
      ...(lifecycleReason ? { lifecycleReason } : {}),
    })}\n`,
  );
  process.exitCode = 1;
}

async function stop(error, retainedAttempts) {
  const reason = error instanceof QueueBlocked ? error.reason : "queue-internal-error";
  const diagnostics = error instanceof QueueBlocked ? error.diagnostics : undefined;
  if (!active || !loop) return { reason };
  const attempts = retainedAttempts ?? (config ? await currentCandidateAttempt(config) : 0);
  try {
    const history = queueAdapter ? await queueAdapter.history() : active.initialHistory;
    const scope = await stopCycle(
      loop,
      { ...active, initialHistory: history },
      reason,
      attempts,
      supervisor,
      repositoryAdapter,
      diagnostics,
    );
    return { reason, scope };
  } catch (stopError) {
    return {
      reason,
      lifecycleReason:
        stopError instanceof QueueBlocked ? stopError.reason : "learning-note-state-unknown",
    };
  }
}

async function main() {
  // Main owns and closes the channel for the whole run; it never requests.
  let admission;
  try {
    if (process.argv.length !== 3) throw new QueueBlocked("usage");
    const executingRoot = await realpath(resolve(import.meta.dirname, "../.."));
    loop = JSON.parse(await readFile(resolve(process.argv[2]), "utf8"));
    validateLoopConfig(loop);
    admission = createNativeDbAdmission(loop.run, process.stdin, process.stdout);
    repositoryAdapter = await loadRepositoryAdapter(loop.adapter, executingRoot);
    process.env.PATH = `${dirname(loop.gitExecutable)}${delimiter}${process.env.PATH ?? ""}`;
    supervisor = repositorySupervisionAdapter();
    for (;;) {
      let retained;
      try {
        if (!active) {
          active = await nextCycle(loop, executingRoot, supervisor, repositoryAdapter);
          if (!active) {
            process.stdout.write(`${JSON.stringify({ status: "idle", run: loop.run })}\n`);
            break;
          }
          await persistCycle(loop, active);
          validatedExecutor = await validateLoopExecutor(loop, executingRoot);
          const pending = await reconcilePendingStop(loop, active, supervisor, repositoryAdapter);
          if (pending?.scope === "run") {
            blocked(new QueueBlocked(pending.reason));
            break;
          }
          if (pending?.scope === "item") {
            if (active.prerequisite) {
              blocked(new QueueBlocked("prerequisite-held"));
              break;
            }
            active = undefined;
            validatedExecutor = undefined;
            continue;
          }
        }
        retained = await retainedPostMergeDelivery(loop, active.selection);
        if (retained) {
          active = { ...active, initialHistory: retained.history };
          try {
            await repositoryAdapter.afterMerge(retained);
          } catch (error) {
            if (error instanceof DeliveryBlocked)
              throw new QueueBlocked(error.reason, error.diagnostics);
            throw error;
          }
          await completeCycle(loop, active, retained.history, supervisor);
          active = undefined;
          validatedExecutor = undefined;
          continue;
        }
        config = await queueConfigFromLoop(
          loop,
          executingRoot,
          {
            key: active.selection.key,
            number: active.selection.number,
            base: active.selection.base,
            ...(active.selection.planningRevision === undefined
              ? {}
              : {
                  planningRevision: active.selection.planningRevision,
                }),
          },
          repositoryAdapter,
          active.initialHistory,
          validatedExecutor,
        );
        queueAdapter = repositoryQueueAdapter(config, executingRoot, {
          gitExecutable: loop.gitExecutable,
          repository: repositoryAdapter,
          native: nativeDbProfileAdapter(codexAdapter(loop.gitExecutable), admission),
        });
        const started = await startCycle(loop, active, supervisor);
        if (started.status === "closed" && !(await hasStartedDelivery(config)))
          throw new QueueBlocked("closed-issue-without-delivery");
        const result = await queueStep(config, queueAdapter);
        process.stdout.write(`${JSON.stringify(result)}\n`);
        if (result.status === "advancing-attempt") continue;
        if (result.status.startsWith("observing-")) {
          await new Promise((done) => setTimeout(done, 10_000));
          continue;
        }
        await completeCycle(loop, active, await queueAdapter.history(), supervisor);
        if (active.prerequisite) {
          blocked(new QueueBlocked("prerequisite-held"));
          break;
        }
        active = undefined;
        config = undefined;
        queueAdapter = undefined;
        validatedExecutor = undefined;
      } catch (error) {
        const outcome = await stop(error, retained?.attempts);
        if (outcome.scope === "item" && !loop.acceptedReplan && !active?.prerequisite) {
          active = undefined;
          config = undefined;
          queueAdapter = undefined;
          validatedExecutor = undefined;
          continue;
        }
        blocked(error, outcome.lifecycleReason);
        break;
      }
    }
  } catch (error) {
    const outcome = await stop(error);
    blocked(error, outcome.lifecycleReason);
  } finally {
    admission?.close();
  }
}

// Import-safe: tests import the factory and validators without running the loop.
// The loader resolves the main entry through the same realpath.
function isEntry() {
  try {
    return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}
if (isEntry()) await main();
