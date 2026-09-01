import { writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import {
  observeProjectPreflight,
  observeWorkerResultPreflight,
} from "../../../packages/adapter-sdk/src/preflight.js";
import {
  canonicalJson,
  canonicalDigest,
  computeDispatchContentReference,
  computeModuleActionPlanDigest,
  computeProjectPreflightDigest,
  computeRouteMappingDigest,
  computeRouteSelectionDigest,
  computeSessionHealthDigest,
  computeReviewRequestDigest,
  computeWorkerResultSubjectDigest,
  computeReviewPacketDigest,
  parseReviewRequest,
  parseProjectPreflightObservation,
  validateReviewResultBinding,
  parseCanonicalContractBytes,
  serializeContract,
  validateDispatchPlanBinding,
  validateModulePlanBinding,
  validateRouteSelectionBinding,
  type ParseResult,
  type ContractRecord,
  type ProjectPreflight,
  type SessionHealth,
  type ProjectPreflightObservation,
} from "@orchestration-platform/contracts";
import { prepareModuleInput, prepareReviewModuleInput } from "./consume.js";
import { echoMapping, echoResource, fixtureId, runEcho } from "./echo-worker.js";
import { initialBreaker } from "./initial-breaker.js";
import { descriptor, plan } from "./index.js";
import { descriptor as reviewDescriptor, plan as reviewPlan } from "./review-module.js";
import {
  readReviewSeed,
  reduceFixtureReview,
  reviewEvidence,
  type ReviewSeed,
} from "./review-source.js";
import { acquireFixtureSession } from "./session.js";

const required = <T extends ContractRecord>(result: ParseResult<T>): T => {
  if (!result.ok) throw new Error(result.issues.join(","));
  return result.value;
};
type OmitLast<T extends readonly unknown[]> = T extends [...infer Rest, unknown] ? Rest : never;
type CycleArgs = [
  ...OmitLast<Parameters<typeof prepareModuleInput>>,
  sessionId: string,
  cycleId: string,
];

/** Actual fixture-only execution through worker exit. No review, journal, replay or final cycle. */
export async function consumeEcho(...args: CycleArgs) {
  return consumeFixed(false, ...args);
}

/** Separate seeded review fixture. No caller-supplied module, renderer or review policy. */
export async function consumeReview(...args: CycleArgs) {
  return consumeFixed(true, ...args);
}

async function consumeFixed(reviewMode: boolean, ...args: CycleArgs) {
  const selectedDescriptor = reviewMode ? reviewDescriptor : descriptor;
  const selectedPlan = reviewMode ? reviewPlan : plan;
  const [adapter, invocation, configuration, snapshot, policy, clocks, sessionId, cycleId] = args;
  const retained = {
    ...invocation,
    flags: { ...invocation.flags },
    environment: { ...invocation.environment },
  };
  const session = await acquireFixtureSession(adapter, retained, sessionId, cycleId, clocks, [
    selectedDescriptor.moduleId,
  ]);
  if (!session.ok) return session;
  if (!session.lease)
    return {
      ok: false as const,
      reason: "SESSION_NOT_ACQUIRED" as const,
      acquisition: session.acquisition,
    };
  const lease = session.lease;
  const files: string[] = [];
  let health: SessionHealth | null = null;
  let uncertain = false;
  let phase = "OBSERVATION_REFUSED";
  const inspect = async () => {
    health = await lease.inspect();
    if (health.outcome !== "HEALTHY") {
      uncertain = true;
      return false;
    }
    return true;
  };
  const execute = async () => {
    health = await lease.observe();
    if (health.outcome !== "HEALTHY") return { ok: false as const, reason: "SESSION_UNHEALTHY" };
    let seed: ReviewSeed | null = null;
    if (reviewMode) {
      if (!retained.flags.projectRoot || !isAbsolute(retained.flags.projectRoot))
        return { ok: false as const, reason: "REVIEW_SOURCE_REFUSED" };
      seed = await readReviewSeed(retained.flags.projectRoot);
    }
    const preparationArgs = [
      adapter,
      retained,
      configuration,
      snapshot,
      policy,
      clocks,
      session.plan.request,
    ] as const;
    const prepared = seed
      ? await prepareReviewModuleInput(seed.subject, ...preparationArgs)
      : await prepareModuleInput(...preparationArgs);
    if (!prepared.ok)
      return { ok: false as const, reason: "OBSERVATION_REFUSED", observation: prepared };
    const initial = await lease.observeInitialRoot();
    if (!initial.ok) return { ok: false as const, reason: initial.reason };
    const input = prepared.input;
    if (
      seed &&
      (seed.subject.baseSource.adapterId !== input.adapterConfiguration.adapterId ||
        seed.subject.baseSource.projectId !== input.adapterConfiguration.projectId)
    )
      return { ok: false as const, reason: "REVIEW_SOURCE_REFUSED" };
    const record = async (name: string, schema: string, value: unknown) => {
      if (!(await inspect())) throw new Error("fixture session changed");
      const encoded = serializeContract(schema, value);
      if (!encoded.ok || !parseCanonicalContractBytes(schema, encoded.bytes).ok)
        throw new Error("fixture output encoding refused");
      phase = "WRITE_REFUSED";
      await writeFile(join(prepared.stateRoot, name), encoded.bytes, { flag: "wx" });
      files.push(name);
    };
    const firstHealth = health;
    const breaker = required(initialBreaker(input));
    for (const evidence of session.evidence)
      await record(`${evidence.schema.split("/")[0]}.json`, evidence.schema, evidence.value);
    await record("session-health.json", "session-health/v1", firstHealth);
    await record(
      "adapter-configuration.json",
      "adapter-configuration/v1",
      input.adapterConfiguration,
    );
    await record("project-facts.json", "project-facts/v1", input.projectFacts);
    await record("project-breaker-facts.json", "project-breaker-facts/v1", input.policyFacts);
    await record("breaker-receipt.json", "breaker-receipt/v1", breaker);
    if (
      breaker.result.kind !== "KNOWN" ||
      !selectedDescriptor.actions.some(
        (declaration) =>
          breaker.result.kind === "KNOWN" &&
          breaker.result.capabilities.some(
            (row) => row.capabilityName === declaration.capabilityName && row.state === "CLOSED",
          ),
      )
    )
      return { ok: false as const, reason: "BREAKER_NOT_CLOSED" };
    phase = "PLAN_REFUSED";
    const action = required(validateModulePlanBinding(input, await selectedPlan(input)));
    await record("module-descriptor.json", "module-descriptor/v1", selectedDescriptor);
    await record("module-input.json", "module-plan-input/v1", input);
    await record("module-result.json", "module-plan-result/v1", action);
    if (action.schemaVersion !== "module-action-plan/v1")
      return { ok: false as const, reason: "NO_ELIGIBLE_ACTION" };
    if (
      breaker.result.kind !== "KNOWN" ||
      !breaker.result.capabilities.some(
        (row) => row.capabilityName === action.actionCore.capabilityName && row.state === "CLOSED",
      )
    )
      return { ok: false as const, reason: "BREAKER_NOT_CLOSED" };
    const route = required(
      validateRouteSelectionBinding(input, action, echoMapping, {
        actionPlanDigest: computeModuleActionPlanDigest(action),
        hostMappingDigest: computeRouteMappingDigest(echoMapping),
        outcome: {
          kind: "SELECTED",
          workerHostIdentityDigest: echoMapping[0]!.workerHostIdentityDigest,
        },
        schemaVersion: "route-selection/v1",
      }),
    );
    await record("route-selection.json", "route-selection/v1", route);
    await record("worker-host.json", "worker-host-renderer-artifact/v1", echoMapping[0]);
    phase = "PREFLIGHT_REFUSED";
    let observation: ProjectPreflightObservation;
    let preflight: ProjectPreflight;
    if (seed) {
      const current = await observeWorkerResultPreflight(
        input,
        action,
        echoMapping,
        route,
        async () => (await readReviewSeed(retained.flags.projectRoot!)).subject,
        fixtureId,
        clocks,
      );
      if (!current.ok)
        return {
          ok: false as const,
          reason: "PREFLIGHT_OBSERVATION_REFUSED",
          observation: current.observation ?? current,
        };
      observation = current.observation;
      preflight = current.preflight;
    } else {
      const current = await observeProjectPreflight(
        input,
        action,
        echoMapping,
        route,
        snapshot,
        clocks,
      );
      if (!current.ok)
        return {
          ok: false as const,
          reason: "PREFLIGHT_OBSERVATION_REFUSED",
          observation: current.observation ?? current,
        };
      observation = current.observation;
      preflight = current.preflight;
    }
    if (observation.kind === "PROJECT")
      await record("preflight-project-facts.json", "project-facts/v1", observation.facts);
    else if (observation.result.kind === "AVAILABLE")
      await record(
        "preflight-review-subject.json",
        "worker-result-subject/v1",
        observation.result.subject,
      );
    if (observation.kind === "REVIEW") {
      // Public closed inline observation: retain its actual random ID/time, without a new schema wrapper.
      const retainedObservation = required(parseProjectPreflightObservation(observation));
      if (!(await inspect())) throw new Error("session changed before review preflight evidence");
      await writeFile(
        join(prepared.stateRoot, "preflight-review-observation.json"),
        canonicalJson(retainedObservation),
        { flag: "wx" },
      );
      files.push("preflight-review-observation.json");
    }
    await record("project-preflight.json", "project-preflight/v1", preflight);
    if (preflight.outcome.kind !== "ELIGIBLE")
      return { ok: false as const, reason: "PREFLIGHT_NOT_ELIGIBLE", preflight };
    if (!(await inspect())) return { ok: false as const, reason: "SESSION_UNHEALTHY" };
    const inspection = health!;
    if (action.dispatchBrief === null) throw new Error("fixed echo needs brief");
    const reviewRequest = seed
      ? required(
          parseReviewRequest({
            packet: {
              brief: action.dispatchBrief,
              evidence: reviewEvidence(seed),
              subject: seed.subject,
            },
            reviewCycleId: input.cycleRequest.cycleId,
            schemaVersion: "review-request/v1",
          }),
        )
      : null;
    if (reviewRequest) await record("review-request.json", "review-request/v1", reviewRequest);
    if (seed) {
      // Retain referenced evidence before the external child effect, so a crash cannot lose its preimages.
      for (const [name, bytes] of [
        ["seed-artifact.bin", seed.artifact],
        ["review-expected.bin", seed.expected],
        ["review-procedure.bin", seed.procedure],
      ] as const) {
        if (!(await inspect())) throw new Error("session changed before review evidence");
        await writeFile(join(prepared.stateRoot, name), bytes, { flag: "wx" });
        files.push(name);
      }
    }
    const rendered = Buffer.from(canonicalJson(reviewRequest?.packet ?? action.dispatchBrief));
    const attemptId = fixtureId();
    const dispatch = required(
      validateDispatchPlanBinding(
        input,
        action,
        echoMapping,
        route,
        observation,
        preflight,
        session.plan,
        inspection,
        reviewRequest,
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
          reviewRequestDigest: reviewRequest ? computeReviewRequestDigest(reviewRequest) : null,
          routeDigest: computeRouteSelectionDigest(route),
          schemaVersion: "dispatch-plan/v1",
          sessionHealthDigest: computeSessionHealthDigest(inspection),
        },
      ),
    );
    await record("dispatch-session-health.json", "session-health/v1", inspection);
    await record("dispatch-plan.json", "dispatch-plan/v1", dispatch);
    phase = "WORKER_OBSERVATION_UNPROVEN";
    uncertain = true;
    const worker = await runEcho(prepared.stateRoot, dispatch, rendered, clocks.wallNow, inspect);
    uncertain = worker.retained;
    await record("worker-launch.json", "worker-launch-receipt/v1", worker.launch);
    if (worker.terminal)
      await record("worker-terminal.json", "worker-terminal-receipt/v1", worker.terminal);
    for (const key of ["stdout", "stderr"] as const) {
      if (worker[key] === null) continue;
      if (!(await inspect())) throw new Error("session changed after worker");
      await writeFile(join(prepared.stateRoot, `${key}.bin`), worker[key], { flag: "wx" });
      files.push(`${key}.bin`);
    }
    if (worker.retained || worker.terminal?.outcome.kind !== "EXITED")
      return { ok: false as const, reason: "WORKER_OBSERVATION_UNPROVEN", worker };
    if (
      worker.terminal.outcome.exit.kind !== "EXIT_CODE" ||
      worker.terminal.outcome.exit.value !== "0" ||
      worker.stdout === null ||
      worker.stderr === null ||
      !Buffer.from(worker.stdout).equals(rendered) ||
      worker.stderr.length !== 0
    )
      return { ok: false as const, reason: "ECHO_RESULT_REFUSED", worker };
    if (seed && reviewRequest) {
      phase = "REVIEW_OBSERVATION_UNPROVEN";
      let current: ReviewSeed | null = null;
      try {
        current = await readReviewSeed(retained.flags.projectRoot!);
      } catch {
        /* unknown target */
      }
      if (
        !current ||
        computeWorkerResultSubjectDigest(current.subject) !==
          computeWorkerResultSubjectDigest(seed.subject)
      ) {
        const authority = required(
          validateReviewResultBinding(reviewRequest, null, {
            outcome: {
              attemptResultDigest: null,
              evidence: reviewEvidence(seed),
              kind: "unknown",
              reason: "TARGET_CHANGED",
            },
            packetDigest: computeReviewPacketDigest(reviewRequest.packet),
            requestDigest: computeReviewRequestDigest(reviewRequest),
            schemaVersion: "review-authority/v1",
            subjectDigest: computeWorkerResultSubjectDigest(seed.subject),
          }),
        );
        await record("review-authority.json", "review-authority/v1", authority);
        return { ok: false as const, reason: "REVIEW_TARGET_CHANGED", authority };
      }
      const review = reduceFixtureReview(
        seed,
        reviewRequest,
        dispatch,
        worker.launch,
        worker.terminal,
        worker.stdout!,
        worker.stderr!,
      );
      await record("review-attempt.json", "review-attempt-result/v1", review.attempt);
      await record("review-authority.json", "review-authority/v1", review.authority);
      if (review.authority.outcome.kind === "rejected")
        return { ok: false as const, reason: "REVIEW_REJECTED", review };
      return { ok: true as const, worker, preflight, route, dispatch, review };
    }
    return { ok: true as const, worker, preflight, route, dispatch };
  };
  let result;
  try {
    result = await execute();
  } catch {
    result = { ok: false as const, reason: phase };
  }
  let cleanup: "REMOVED" | "RETAINED_UNKNOWN";
  try {
    cleanup = uncertain ? await lease.retain() : await lease.close();
  } catch {
    cleanup = "RETAINED_UNKNOWN";
  }
  if (cleanup !== "REMOVED")
    return {
      ok: false as const,
      reason: "SESSION_RETAINED_UNKNOWN",
      files,
      acquisition: session.acquisition,
      health,
      cleanup,
      observation: result,
    };
  return { ...result, files, acquisition: session.acquisition, health, cleanup };
}
