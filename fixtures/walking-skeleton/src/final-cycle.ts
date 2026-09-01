import { createHash } from "node:crypto";
import { type BigIntStats } from "node:fs";
import { lstat, open, readFile, readdir, realpath, unlink } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  canonicalDigest,
  canonicalJson,
  computeActionDispositionDigest,
  computeCycleRequestDigest,
  computeCycleReceiptDigest,
  computeDispatchContentReference,
  computeDispatchPlanDigest,
  computeDispositionInputDigest,
  computeEventJournalDigest,
  computeModuleActionPlanDigest,
  computeModulePlanInputDigest,
  computeProjectPreflightDigest,
  computeProjectPreflightObservationDigest,
  computeEventJournalPrefixDigest,
  computeReducedStateDigest,
  computeReviewAttemptResultDigest,
  computeReviewRequestDigest,
  computeResourceReclaimContextDigest,
  computeRouteMappingDigest,
  computeRouteSelectionDigest,
  computeRoutineStepSkipDigest,
  computeSessionHealthDigest,
  computeWorkerLaunchReceiptDigest,
  computeWorkerResultSubjectDigest,
  parseCanonicalContractBytes,
  parseCycleReceipt,
  parseDispositionInput,
  parseFollowUpCycleRequest,
  parseProjectPreflightObservation,
  parseReviewRequest,
  parseRoutineStepSkip,
  serializeContract,
  validateActionDispositionBinding,
  validateCycleReceiptBinding,
  validateDispatchPlanBinding,
  validateFollowUpCycleRequestBinding,
  validateModulePlanBinding,
  validateProjectPreflightBinding,
  validateResourceReclaimReceiptBinding,
  validateReviewResultBinding,
  validateRouteSelectionBinding,
  type ContractRecord,
  type CycleReceipt,
  type FollowUpCycleRequest,
  type ParseResult,
  type ReclaimOwnerObservation,
  type ResourceReclaimContext,
  type ReclaimProcessObservation,
  type ReviewAttemptResult,
  type RetainedEvidenceInput,
  type RoutineStepIdentity,
  type WorkerLaunchReceipt,
} from "@orchestration-platform/contracts";
import type { CurrentPolicyReader } from "../../../packages/adapter-sdk/src/current-policy.js";
import type { SnapshotClocks, SnapshotReader } from "../../../packages/adapter-sdk/src/snapshot.js";
import type {
  ConfigurationHostAdapter,
  ConfigurationLoaderInvocation,
} from "../../../packages/config/src/loader.js";
import {
  composeFixtureModuleInput,
  loadFixtureConfiguration,
  observeFixturePolicy,
  observeFixtureSnapshot,
} from "./consume.js";
import { echoMapping, echoResource, fixtureId, runEcho, type EchoBoundary } from "./echo-worker.js";
import { initialBreaker } from "./initial-breaker.js";
import {
  FixtureJournalOwner,
  replayFixtureJournal,
  type SkeletonJournalBoundary,
} from "./journal-owner.js";
import { descriptor, disposition, plan } from "./review-module.js";
import {
  observeFixtureReviewAttempt,
  readReviewSeed,
  reduceFixtureReviewAuthority,
  reviewEvidence,
} from "./review-source.js";
import { acquireFixtureSession, type FixtureSessionClocks } from "./session.js";

export type SkeletonBoundary =
  | SkeletonJournalBoundary
  | EchoBoundary
  | "RECLAIM_BEFORE_DELETE"
  | "RECLAIM_AFTER_DELETE"
  | "SESSION_CLOSED";
export type SkeletonBoundarySnapshot = Readonly<{
  boundary: SkeletonBoundary;
  journalByteLength: number | null;
  journalPrefixDigest: string | null;
  reducedOutcome: string | null;
  stateFiles: readonly string[];
}>;
export type SkeletonBoundaryHandler = (snapshot: SkeletonBoundarySnapshot) => void | Promise<void>;

export class SkeletonBoundaryFault extends Error {
  constructor(readonly boundary: SkeletonBoundary) {
    super(`fixture boundary fault: ${boundary}`);
  }
}

export type FinalCycleInvocation = Readonly<{
  adapter: ConfigurationHostAdapter;
  adapterConfiguration: unknown;
  boundary?: SkeletonBoundaryHandler;
  clocks: SnapshotClocks & FixtureSessionClocks;
  currentPolicy: CurrentPolicyReader;
  cycleId: string;
  disposableRoot: string;
  invocation: ConfigurationLoaderInvocation;
  sessionId: string;
  snapshot: SnapshotReader;
}>;

const required = <T extends ContractRecord>(result: ParseResult<T>): T => {
  if (!result.ok) throw new Error(result.issues.join(","));
  return result.value;
};
const sameFile = (left: BigIntStats, right: BigIntStats) =>
  left.dev === right.dev && left.ino === right.ino && left.mode === right.mode;
const inside = (parent: string, child: string) => {
  const fromParent = relative(parent, child);
  return (
    fromParent !== "" &&
    fromParent !== ".." &&
    !fromParent.startsWith(`..${sep}`) &&
    !isAbsolute(fromParent)
  );
};

async function manifest(root: string, excluded: string | null = null) {
  const rows: string[] = [];
  async function visit(path: string, prefix: string) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const absolute = join(path, entry.name);
      if (absolute === excluded) continue;
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        rows.push(`directory:${name}`);
        await visit(absolute, name);
      } else if (entry.isFile())
        rows.push(
          `file:${name}:${createHash("sha256")
            .update(await readFile(absolute))
            .digest("hex")}`,
        );
      else throw new Error("fixture manifest path kind refused");
    }
  }
  await visit(root, "");
  return rows.sort();
}

async function createOnce(path: string, bytes: Uint8Array) {
  const handle = await open(path, "wx+", 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
    const before = await handle.stat({ bigint: true });
    const observed = Buffer.alloc(Number(before.size));
    const read = await handle.read(observed, 0, observed.byteLength, 0);
    const after = await handle.stat({ bigint: true });
    if (
      !before.isFile() ||
      before.nlink !== 1n ||
      !sameFile(before, after) ||
      read.bytesRead !== observed.byteLength ||
      !observed.equals(Buffer.from(bytes))
    )
      throw new Error("fixture evidence read-back mismatch");
  } finally {
    await handle.close();
  }
}

async function retainedFile(path: string, maximum = 4096) {
  const before = await lstat(path, { bigint: true });
  if (
    !before.isFile() ||
    before.nlink !== 1n ||
    before.size > BigInt(maximum) ||
    (await realpath(path)) !== path
  )
    throw new Error("fixture managed resource refused");
  const handle = await open(path, "r");
  try {
    const opened = await handle.stat({ bigint: true });
    const bytes = await handle.readFile();
    const after = await lstat(path, { bigint: true });
    if (
      !sameFile(before, opened) ||
      !sameFile(before, after) ||
      BigInt(bytes.length) !== before.size
    )
      throw new Error("fixture managed resource changed");
    return bytes;
  } finally {
    await handle.close();
  }
}

function observation(
  observationId: string,
  observedAt: string,
  bytes: Uint8Array | null,
): ReclaimOwnerObservation {
  return {
    observationId,
    observedAt,
    result: {
      kind: "COMPLETE",
      value:
        bytes === null
          ? { kind: "ABSENT" }
          : { bytes: Buffer.from(bytes).toString("hex"), kind: "PRESENT" },
    },
  };
}

function skip(step: RoutineStepIdentity, reason: "no-mutation") {
  return required(parseRoutineStepSkip({ reason, schemaVersion: "routine-step-skip/v1", step }));
}

function evidence(bytes: Uint8Array, kind: RetainedEvidenceInput["kind"]): RetainedEvidenceInput {
  return { bytes: Uint8Array.from(bytes), kind };
}

function outcomeName(value: unknown) {
  if (value && typeof value === "object" && !Array.isArray(value) && "kind" in value)
    return String((value as { kind: unknown }).kind);
  return null;
}

function checkRoots(input: FinalCycleInvocation) {
  const disposableRoot = resolve(input.disposableRoot);
  const projectRoot = input.invocation.flags.projectRoot
    ? resolve(input.invocation.flags.projectRoot)
    : null;
  const stateRoot = input.invocation.flags.stateRoot
    ? resolve(input.invocation.flags.stateRoot)
    : null;
  const checkout = resolve(import.meta.dirname, "../../..");
  if (
    !isAbsolute(input.disposableRoot) ||
    projectRoot === null ||
    stateRoot === null ||
    !inside(disposableRoot, projectRoot) ||
    !inside(disposableRoot, stateRoot) ||
    inside(checkout, stateRoot) ||
    stateRoot === checkout
  )
    throw new Error("fixture disposable roots refused");
  return { checkout, disposableRoot, projectRoot, stateRoot };
}

/**
 * One fixture-only review cycle. It is evidence, never production authority.
 * The reviewed subject is seeded by a distinct earlier cycle/attempt.
 */
export async function consumeFinalReviewCycle(input: FinalCycleInvocation) {
  const roots = checkRoots(input);
  const journalPath = join(roots.stateRoot, "cycle.opj");
  const outsideBefore = await manifest(roots.disposableRoot, roots.stateRoot);
  const session = await acquireFixtureSession(
    input.adapter,
    input.invocation,
    input.sessionId,
    input.cycleId,
    input.clocks,
    [descriptor.moduleId],
  );
  if (!session.ok) return session;
  if (!session.lease)
    return {
      acquisition: session.acquisition,
      ok: false as const,
      reason: "SESSION_NOT_ACQUIRED" as const,
    };

  const lease = session.lease;
  let journal: FixtureJournalOwner | null = null;
  let uncertain = false;
  let lastBoundary: SkeletonBoundary | null = null;
  const files: string[] = [];
  const signal = async (
    boundary: SkeletonBoundary,
    observed: Readonly<{
      byteLength: number;
      prefixDigest: string;
      reduced: { outcome: unknown } | null;
    }> | null = null,
  ) => {
    lastBoundary = boundary;
    if (!input.boundary) return;
    const replay = journal?.replay();
    await input.boundary({
      boundary,
      journalByteLength: observed?.byteLength ?? journal?.bytes.byteLength ?? null,
      journalPrefixDigest:
        observed?.prefixDigest ??
        (journal === null ? null : computeEventJournalPrefixDigest(journal.bytes)),
      reducedOutcome:
        observed?.reduced !== null && observed?.reduced !== undefined
          ? outcomeName(observed.reduced.outcome)
          : replay?.ok
            ? outcomeName(replay.value.outcome)
            : null,
      stateFiles: (await readdir(roots.stateRoot)).sort(),
    });
  };
  const writeRecord = async (name: string, schema: string, value: unknown) => {
    const encoded = serializeContract(schema, value);
    if (!encoded.ok || !parseCanonicalContractBytes(schema, encoded.bytes).ok)
      throw new Error(`fixture record refused: ${name}`);
    await createOnce(join(roots.stateRoot, name), encoded.bytes);
    files.push(name);
  };

  try {
    const genesis = await lease.observeInitialRoot();
    if (!genesis.ok) throw new Error(`fixture genesis refused: ${genesis.reason}`);
    journal = await FixtureJournalOwner.create(journalPath, session.plan, async (boundary, state) =>
      signal(boundary, state),
    );
    files.push("cycle.opj");

    for (const row of session.evidence)
      await writeRecord(`${row.schema.split("/")[0]}.json`, row.schema, row.value);

    const step1 = journal.step(1, computeCycleRequestDigest(session.plan.request));
    await journal.start(step1);
    const health = await lease.observe();
    if (health.outcome !== "HEALTHY") throw new Error("fixture session unhealthy at step 1");
    await journal.terminal(step1, { cyclePlan: session.plan, health, kind: "SESSION" });
    await writeRecord("session-health.json", "session-health/v1", health);

    const configuration = await loadFixtureConfiguration(
      input.adapter,
      input.invocation,
      input.adapterConfiguration,
      session.plan.request,
    );
    if (!configuration.ok) throw new Error("fixture configuration refused");
    const step2 = journal.step(2, canonicalDigest(configuration.value.configuration));
    await journal.start(step2);
    const snapshot = await observeFixtureSnapshot(
      configuration.value,
      input.snapshot,
      input.clocks,
    );
    if (!snapshot.ok) throw new Error("fixture snapshot call refused");
    await journal.terminal(step2, {
      configuration: configuration.value.configuration,
      facts: snapshot.value,
      kind: "PROJECT_FACTS",
    });
    await writeRecord(
      "adapter-configuration.json",
      "adapter-configuration/v1",
      configuration.value.configuration,
    );
    await writeRecord("project-facts.json", "project-facts/v1", snapshot.value);
    if (snapshot.value.state !== "COMPLETE")
      throw new Error(`fixture frontier refused: ${snapshot.value.reason}`);

    const step3 = journal.step(3, canonicalDigest(snapshot.value));
    await journal.start(step3);
    const policy = await observeFixturePolicy(
      configuration.value,
      snapshot.value,
      input.currentPolicy,
      input.clocks,
    );
    if (!policy.ok || policy.value.state !== "COMPLETE") throw new Error("fixture policy refused");
    const seed = await readReviewSeed(roots.projectRoot);
    if (
      seed.subject.authorCycleId === input.cycleId ||
      seed.subject.baseSource.adapterId !== configuration.value.configuration.adapterId ||
      seed.subject.baseSource.projectId !== configuration.value.configuration.projectId
    )
      throw new Error("fixture distinct review source refused");
    const moduleInput = required(
      composeFixtureModuleInput(
        descriptor,
        seed.subject,
        configuration.value,
        snapshot.value,
        policy.value,
      ),
    );
    const breaker = required(initialBreaker(moduleInput));
    await journal.terminal(step3, {
      configuration: moduleInput.adapterConfiguration,
      cycleRequest: moduleInput.cycleRequest,
      kind: "BREAKER",
      policyFacts: moduleInput.policyFacts,
      prior: null,
      projectFacts: moduleInput.projectFacts,
      provenance: moduleInput.configurationProvenance,
      receipt: breaker,
    });
    await writeRecord("project-breaker-facts.json", "project-breaker-facts/v1", policy.value);
    await writeRecord("breaker-receipt.json", "breaker-receipt/v1", breaker);
    if (
      breaker.result.kind !== "KNOWN" ||
      !breaker.result.capabilities.some(
        (row) => row.capabilityName === "work.read" && row.state === "CLOSED",
      )
    )
      throw new Error("fixture breaker did not admit review capability");

    const step4 = journal.step(4, computeModulePlanInputDigest(moduleInput));
    await journal.start(step4);
    const action = required(validateModulePlanBinding(moduleInput, await plan(moduleInput)));
    if (action.schemaVersion !== "module-action-plan/v1")
      throw new Error("fixture review action required");
    await journal.terminal(step4, { input: moduleInput, kind: "MODULE", result: action });
    await writeRecord("module-descriptor.json", "module-descriptor/v1", descriptor);
    await writeRecord("module-input.json", "module-plan-input/v1", moduleInput);
    await writeRecord("module-result.json", "module-plan-result/v1", action);

    const step5 = journal.step(5, computeModuleActionPlanDigest(action));
    await journal.start(step5);
    const route = required(
      validateRouteSelectionBinding(moduleInput, action, echoMapping, {
        actionPlanDigest: computeModuleActionPlanDigest(action),
        hostMappingDigest: computeRouteMappingDigest(echoMapping),
        outcome: {
          kind: "SELECTED",
          workerHostIdentityDigest: echoMapping[0]!.workerHostIdentityDigest,
        },
        schemaVersion: "route-selection/v1",
      }),
    );
    await journal.terminal(step5, {
      action,
      input: moduleInput,
      kind: "ROUTE",
      mapping: echoMapping,
      route,
    });
    await writeRecord("route-selection.json", "route-selection/v1", route);
    await writeRecord("worker-host.json", "worker-host-renderer-artifact/v1", echoMapping[0]);

    const step6 = journal.step(6, computeRouteSelectionDigest(route));
    await journal.start(step6);
    const currentSeed = await readReviewSeed(roots.projectRoot);
    const observation = required(
      parseProjectPreflightObservation({
        adapterConfigurationDigest: canonicalDigest(moduleInput.adapterConfiguration),
        kind: "REVIEW",
        observationId: fixtureId(),
        observedAt: input.clocks.wallNow(),
        result:
          computeWorkerResultSubjectDigest(currentSeed.subject) ===
          computeWorkerResultSubjectDigest(seed.subject)
            ? { kind: "AVAILABLE", subject: currentSeed.subject }
            : { kind: "UNKNOWN" },
      }),
    );
    const preflight = required(
      validateProjectPreflightBinding(moduleInput, action, echoMapping, route, observation, {
        actionPlanDigest: computeModuleActionPlanDigest(action),
        observationDigest: computeProjectPreflightObservationDigest(observation),
        outcome:
          observation.kind === "REVIEW" && observation.result.kind === "AVAILABLE"
            ? { kind: "ELIGIBLE" }
            : { kind: "UNKNOWN", reason: "SOURCE_UNKNOWN" },
        routeDigest: computeRouteSelectionDigest(route),
        schemaVersion: "project-preflight/v1",
      }),
    );
    await journal.terminal(step6, {
      action,
      input: moduleInput,
      kind: "PREFLIGHT",
      mapping: echoMapping,
      observation,
      preflight,
      route,
    });
    await createOnce(
      join(roots.stateRoot, "preflight-review-observation.json"),
      Buffer.from(canonicalJson(observation)),
    );
    files.push("preflight-review-observation.json");
    if (observation.kind === "REVIEW" && observation.result.kind === "AVAILABLE")
      await writeRecord(
        "preflight-review-subject.json",
        "worker-result-subject/v1",
        observation.result.subject,
      );
    await writeRecord("project-preflight.json", "project-preflight/v1", preflight);
    if (preflight.outcome.kind !== "ELIGIBLE") throw new Error("fixture preflight refused");

    const step7 = journal.step(7, computeProjectPreflightDigest(preflight));
    await journal.start(step7);
    const dispatchHealth = await lease.inspect();
    if (dispatchHealth.outcome !== "HEALTHY") throw new Error("fixture dispatch health refused");
    const request = required(
      parseReviewRequest({
        packet: {
          brief: action.dispatchBrief,
          evidence: reviewEvidence(seed),
          subject: seed.subject,
        },
        reviewCycleId: input.cycleId,
        schemaVersion: "review-request/v1",
      }),
    );
    const rendered = Buffer.from(canonicalJson(request.packet));
    if (rendered.byteLength > 4096) throw new Error("fixture rendered input exceeds reclaim bound");
    for (const [name, bytes] of [
      ["rendered-input.bin", rendered],
      ["seed-artifact.bin", seed.artifact],
      ["review-expected.bin", seed.expected],
      ["review-procedure.bin", seed.procedure],
    ] as const) {
      await createOnce(join(roots.stateRoot, name), bytes);
      files.push(name);
    }
    const attemptId = fixtureId();
    const dispatch = required(
      validateDispatchPlanBinding(
        moduleInput,
        action,
        echoMapping,
        route,
        observation,
        preflight,
        session.plan,
        dispatchHealth,
        request,
        rendered,
        {
          actionPlanDigest: computeModuleActionPlanDigest(action),
          attemptId,
          outcome: {
            credentials: { kind: "NONE" },
            hostRendererArtifactDigest: echoMapping[0]!.hostRendererArtifactDigest,
            kind: "PLANNED",
            renderedInput: computeDispatchContentReference(rendered),
            resourceIntents: [echoResource(attemptId)],
            workerHostIdentityDigest: echoMapping[0]!.workerHostIdentityDigest,
          },
          preflightDigest: computeProjectPreflightDigest(preflight),
          reviewRequestDigest: computeReviewRequestDigest(request),
          routeDigest: computeRouteSelectionDigest(route),
          schemaVersion: "dispatch-plan/v1",
          sessionHealthDigest: computeSessionHealthDigest(dispatchHealth),
        },
      ),
    );
    await journal.terminal(
      step7,
      {
        action,
        cyclePlan: session.plan,
        health: dispatchHealth,
        input: moduleInput,
        kind: "DISPATCH_PLAN",
        mapping: echoMapping,
        observation,
        plan: dispatch,
        preflight,
        reviewRequest: request,
        route,
      },
      [evidence(rendered, "RENDERED_INPUT")],
    );
    await writeRecord("review-request.json", "review-request/v1", request);
    await writeRecord("dispatch-session-health.json", "session-health/v1", dispatchHealth);
    await writeRecord("dispatch-plan.json", "dispatch-plan/v1", dispatch);

    const step8 = journal.step(8, computeDispatchPlanDigest(dispatch));
    await journal.start(step8);
    uncertain = true;
    let step9: RoutineStepIdentity | null = null;
    let workerLaunch: WorkerLaunchReceipt | null = null;
    let attempt: ReviewAttemptResult | null = null;
    let process: ReclaimProcessObservation | null = null;
    const worker = await runEcho(
      roots.stateRoot,
      dispatch,
      rendered,
      input.clocks.wallNow,
      async () => (await lease.inspect()).outcome === "HEALTHY",
      {
        boundary: signal,
        launched: async (launch) => {
          workerLaunch = launch;
          await journal!.terminal(step8, {
            kind: "LAUNCH",
            launch,
            plan: dispatch,
            terminal: null,
          });
          await writeRecord("worker-launch.json", "worker-launch-receipt/v1", launch);
          step9 = journal!.step(9, computeWorkerLaunchReceiptDigest(launch));
          await journal!.start(step9);
        },
        terminal: async (terminal, stdout, stderr, processObservation) => {
          if (step9 === null) throw new Error("fixture step 9 missing");
          await createOnce(join(roots.stateRoot, "stdout.bin"), stdout);
          await createOnce(join(roots.stateRoot, "stderr.bin"), stderr);
          files.push("stdout.bin", "stderr.bin");
          attempt = observeFixtureReviewAttempt(
            seed,
            request,
            dispatch,
            workerLaunch!,
            terminal,
            stdout,
            stderr,
          );
          process = processObservation;
          await journal!.terminal(
            step9,
            {
              attempt,
              kind: "WORKER_TERMINAL",
              launch: workerLaunch,
              plan: dispatch,
              resultSubject: null,
              terminal,
            },
            [evidence(stderr, "STDERR"), evidence(stdout, "STDOUT")],
          );
          await writeRecord("worker-terminal.json", "worker-terminal-receipt/v1", terminal);
          await writeRecord("review-attempt.json", "review-attempt-result/v1", attempt);
        },
      },
    );
    if (
      worker.retained ||
      worker.terminal?.outcome.kind !== "EXITED" ||
      worker.terminal.outcome.exit.kind !== "EXIT_CODE" ||
      worker.terminal.outcome.exit.value !== "0" ||
      worker.stdout === null ||
      worker.stderr === null ||
      attempt === null ||
      process === null
    )
      throw new Error("fixture worker observation refused");
    uncertain = false;

    const step10 = journal.step(10, computeReviewAttemptResultDigest(attempt));
    await journal.start(step10);
    const authority = reduceFixtureReviewAuthority(seed, request, attempt);
    required(validateReviewResultBinding(request, attempt, authority));
    await journal.terminal(step10, {
      attempt,
      authority,
      kind: "REVIEW_AUTHORITY",
      request,
    });
    await writeRecord("review-authority.json", "review-authority/v1", authority);

    const dispositionInput = required(
      parseDispositionInput({
        actionPlan: action,
        moduleInput,
        preflight,
        review: { attempt, authority, request },
        route,
        skips: [],
        worker: {
          launch: worker.launch,
          plan: dispatch,
          resultSubject: null,
          terminal: worker.terminal,
        },
      }),
    );
    const step11 = journal.step(11, computeDispositionInputDigest(dispositionInput));
    await journal.start(step11);
    const decision = required(
      validateActionDispositionBinding(
        dispositionInput,
        worker.stdout,
        worker.stderr,
        await disposition(dispositionInput),
      ),
    );
    let followUp: FollowUpCycleRequest | null = null;
    if ("followUp" in decision.outcome && decision.outcome.followUp !== null) {
      followUp = required(
        parseFollowUpCycleRequest({
          cause: { digest: computeActionDispositionDigest(decision), kind: "DISPOSITION" },
          intent: decision.outcome.followUp,
          schemaVersion: "follow-up-cycle-request/v1",
          sourceCycleId: input.cycleId,
        }),
      );
      required(
        validateFollowUpCycleRequestBinding(
          dispositionInput,
          worker.stdout,
          worker.stderr,
          decision,
          followUp,
        ),
      );
    }
    await journal.terminal(
      step11,
      { disposition: decision, followUp, input: dispositionInput, kind: "DISPOSITION" },
      [evidence(worker.stderr, "STDERR"), evidence(worker.stdout, "STDOUT")],
    );
    await writeRecord("action-disposition.json", "action-disposition/v1", decision);
    if (followUp)
      await writeRecord("follow-up-cycle-request.json", "follow-up-cycle-request/v1", followUp);

    const step12 = journal.step(12, computeActionDispositionDigest(decision));
    const skip12 = skip(step12, "no-mutation");
    await journal.start(step12);
    await journal.terminal(step12, { kind: "SKIP", skip: skip12 });
    await writeRecord("routine-step-skip-12.json", "routine-step-skip/v1", skip12);
    const step13 = journal.step(13, computeRoutineStepSkipDigest(skip12));
    const skip13 = skip(step13, "no-mutation");
    await journal.start(step13);
    await journal.terminal(step13, { kind: "SKIP", skip: skip13 });
    await writeRecord("routine-step-skip-13.json", "routine-step-skip/v1", skip13);

    const reclaimHealth = await lease.inspect();
    if (reclaimHealth.outcome !== "HEALTHY") throw new Error("fixture reclaim health refused");
    const context: ResourceReclaimContext = {
      adapterConfiguration: moduleInput.adapterConfiguration,
      configurationProvenance: moduleInput.configurationProvenance,
      cyclePlan: session.plan,
      origin: {
        disposition: decision,
        dispositionInput,
        followUp,
        kind: "ACTION",
        mutation: null,
      },
      sessionHealth: reclaimHealth,
      skips: [skip12, skip13],
    };
    const step14 = journal.step(14, computeResourceReclaimContextDigest(context));
    await journal.start(step14);
    const resourcePath = join(roots.stateRoot, "echo-input.bin");
    const beforeBytes = await retainedFile(resourcePath);
    if (!beforeBytes.equals(rendered)) throw new Error("fixture reclaim input mismatch");
    await signal("RECLAIM_BEFORE_DELETE");
    const before = observation(fixtureId(), input.clocks.wallNow(), beforeBytes);
    await unlink(resourcePath);
    try {
      await lstat(resourcePath);
      throw new Error("fixture reclaim absence not observed");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await signal("RECLAIM_AFTER_DELETE");
    const after = observation(fixtureId(), input.clocks.wallNow(), null);
    const reclaimTransactionId = fixtureId();
    const reclaim = required(
      validateResourceReclaimReceiptBinding(context, null, worker.stdout, worker.stderr, {
        contextDigest: computeResourceReclaimContextDigest(context),
        cycleId: input.cycleId,
        observations: worker.launch.resources.map((allocation) => ({
          after,
          allocation,
          before,
          outcome: { kind: "RECLAIMED" },
          reclaimTransactionId,
          source: "DISPATCH",
        })),
        outcome: { kind: "RECLAIMED" },
        process,
        reclaimTransactionId,
        schemaVersion: "resource-reclaim-receipt/v1",
      }),
    );
    await journal.terminal(step14, { context, kind: "RECLAIM", receipt: reclaim }, [
      evidence(worker.stderr, "STDERR"),
      evidence(worker.stdout, "STDOUT"),
    ]);
    await writeRecord("resource-reclaim-receipt.json", "resource-reclaim-receipt/v1", reclaim);

    const pre15 = journal.replay();
    if (!pre15.ok || pre15.value.outcome.kind === "UNKNOWN")
      throw new Error("fixture preterminal replay refused");
    const step15 = journal.step(15, computeReducedStateDigest(pre15.value));
    await journal.start(step15);
    const terminalizing = journal.replay();
    if (!terminalizing.ok || terminalizing.value.outcome.kind !== "TERMINALIZING")
      throw new Error("fixture terminalizing replay refused");
    const receiptOutcome: CycleReceipt["outcome"] =
      authority.outcome.kind === "accepted" ? "COMPLETED" : "FAILED_KNOWN";
    const cycleReceipt = required(
      parseCycleReceipt({
        bindings: terminalizing.value.bindings,
        cycleId: input.cycleId,
        cyclePlanDigest: terminalizing.value.cyclePlanDigest,
        outcome: receiptOutcome,
        reclaimOutcome: (reclaim.outcome as { kind: "RECLAIMED" }).kind,
        reducedStateDigest: computeReducedStateDigest(terminalizing.value),
        schemaVersion: "cycle-receipt/v1",
        sessionId: input.sessionId,
        startedJournalPrefixDigest: terminalizing.value.journalPrefixDigest,
        steps: terminalizing.value.steps,
        terminalStepDigest: terminalizing.value.outcome.terminalStepDigest,
      }),
    );
    required(
      validateCycleReceiptBinding(
        journal.journal,
        terminalizing.value,
        cycleReceipt,
        journal.evidence,
      ),
    );
    await journal.terminal(step15, { kind: "CYCLE_TERMINAL", receipt: cycleReceipt });
    await writeRecord("cycle-receipt.json", "cycle-receipt/v1", cycleReceipt);
    const final = journal.replay();
    if (
      !final.ok ||
      final.value.outcome.kind !== receiptOutcome ||
      final.value.outcome.cycleReceiptDigest !== computeCycleReceiptDigest(cycleReceipt)
    )
      throw new Error("fixture final replay refused");
    const journalDigest = computeEventJournalDigest(journal.journal);
    await journal.close();
    const persisted = await replayFixtureJournal(journalPath, {
      RENDERED_INPUT: join(roots.stateRoot, "rendered-input.bin"),
      STDERR: join(roots.stateRoot, "stderr.bin"),
      STDOUT: join(roots.stateRoot, "stdout.bin"),
    });
    if (
      !persisted.ok ||
      persisted.value.reduced.outcome.kind !== receiptOutcome ||
      persisted.value.reduced.outcome.cycleReceiptDigest !== computeCycleReceiptDigest(cycleReceipt)
    )
      throw new Error("fixture closed journal read-back refused");
    journal = null;
    const cleanup = await lease.close();
    if (cleanup !== "REMOVED") throw new Error("fixture session cleanup refused");
    await signal("SESSION_CLOSED");
    const outsideAfter = await manifest(roots.disposableRoot, roots.stateRoot);
    if (canonicalJson(outsideAfter) !== canonicalJson(outsideBefore))
      throw new Error("fixture outside-state manifest changed");
    const stateFiles = (await readdir(roots.stateRoot)).sort();
    return {
      acquisition: session.acquisition,
      cleanup,
      cycleReceipt,
      files: stateFiles,
      journalDigest,
      ok: authority.outcome.kind === "accepted",
      outcome: receiptOutcome,
      outsideAfter,
      outsideBefore,
      reason: authority.outcome.kind === "accepted" ? null : ("REVIEW_REJECTED" as const),
      reduced: persisted.value.reduced,
    };
  } catch (error) {
    await journal?.close().catch(() => undefined);
    const injected = error instanceof SkeletonBoundaryFault;
    let cleanup: "REMOVED" | "RETAINED_UNKNOWN" = "RETAINED_UNKNOWN";
    try {
      cleanup =
        uncertain || injected || journal !== null ? await lease.retain() : await lease.close();
    } catch {
      cleanup = "RETAINED_UNKNOWN";
    }
    return {
      acquisition: session.acquisition,
      boundary: injected ? error.boundary : lastBoundary,
      cleanup,
      files: (await readdir(roots.stateRoot)).sort(),
      ok: false as const,
      reason: injected ? ("FAULT_INJECTED" as const) : ("CYCLE_REFUSED" as const),
    };
  }
}

/** Typed pre-admission malformed-frontier control; no journal or worker is created. */
export async function observeMalformedFrontierControl(input: FinalCycleInvocation) {
  const roots = checkRoots(input);
  const session = await acquireFixtureSession(
    input.adapter,
    input.invocation,
    input.sessionId,
    input.cycleId,
    input.clocks,
    [descriptor.moduleId],
  );
  if (!session.ok || !session.lease) return session;
  const configuration = await loadFixtureConfiguration(
    input.adapter,
    input.invocation,
    input.adapterConfiguration,
    session.plan.request,
  );
  const facts = configuration.ok
    ? await observeFixtureSnapshot(configuration.value, input.snapshot, input.clocks)
    : configuration;
  const malformed =
    facts.ok && facts.value.state === "UNKNOWN" && facts.value.reason === "MALFORMED_OBSERVATION";
  const cleanup = await session.lease.close();
  return {
    acquisition: session.acquisition,
    cleanup,
    facts: facts.ok ? facts.value : null,
    files: (await readdir(roots.stateRoot)).sort(),
    ok: false as const,
    reason: malformed ? ("MALFORMED_FRONTIER" as const) : ("CONTROL_NOT_OBSERVED" as const),
  };
}

/** Two actual acquisitions; the contender must stop before every cycle callback. */
export async function observeConcurrentLeaseControl(
  holder: FinalCycleInvocation,
  contender: Pick<FinalCycleInvocation, "cycleId" | "sessionId">,
) {
  checkRoots(holder);
  const acquired = await acquireFixtureSession(
    holder.adapter,
    holder.invocation,
    holder.sessionId,
    holder.cycleId,
    holder.clocks,
    [descriptor.moduleId],
  );
  if (!acquired.ok || !acquired.lease) return acquired;
  const before = await readFile(join(holder.invocation.flags.stateRoot!, "session-claim.json"));
  const refused = await acquireFixtureSession(
    holder.adapter,
    holder.invocation,
    contender.sessionId,
    contender.cycleId,
    holder.clocks,
    [descriptor.moduleId],
  );
  const after = await readFile(join(holder.invocation.flags.stateRoot!, "session-claim.json"));
  const cleanup = await acquired.lease.close();
  return {
    cleanup,
    holder: acquired.acquisition,
    ok: false as const,
    reason:
      refused.ok &&
      refused.lease === null &&
      refused.acquisition.outcome === "REFUSED" &&
      refused.acquisition.reason === "SESSION_HELD" &&
      before.equals(after)
        ? ("SESSION_HELD" as const)
        : ("CONTROL_NOT_OBSERVED" as const),
    refused: refused.ok ? refused.acquisition : null,
  };
}

/** Read-only prefix replay followed by the fixture's required no-adoption refusal. */
export async function inspectFinalCycleRestart(input: FinalCycleInvocation) {
  const roots = checkRoots(input);
  let replay: Awaited<ReturnType<typeof replayFixtureJournal>> | null = null;
  try {
    replay = await replayFixtureJournal(join(roots.stateRoot, "cycle.opj"), {
      RENDERED_INPUT: join(roots.stateRoot, "rendered-input.bin"),
      STDERR: join(roots.stateRoot, "stderr.bin"),
      STDOUT: join(roots.stateRoot, "stdout.bin"),
    });
  } catch {
    // A crash before an evidence file is retained remains an unreadable prefix,
    // but it still cannot authorize adoption or another effect.
  }
  const acquisition = await acquireFixtureSession(
    input.adapter,
    input.invocation,
    input.sessionId,
    input.cycleId,
    input.clocks,
    [descriptor.moduleId],
  );
  if (acquisition.ok && acquisition.lease) {
    await acquisition.lease.retain();
    return {
      acquisition: acquisition.acquisition,
      ok: false as const,
      reason: "UNEXPECTED_ADOPTION" as const,
      replay,
    };
  }
  const refused =
    acquisition.ok &&
    acquisition.acquisition.outcome === "REFUSED" &&
    acquisition.acquisition.reason === "SESSION_HELD";
  return {
    acquisition: acquisition.ok ? acquisition.acquisition : null,
    ok: false as const,
    reason: refused ? ("SESSION_HELD" as const) : ("RESTART_UNPROVEN" as const),
    replay,
  };
}
