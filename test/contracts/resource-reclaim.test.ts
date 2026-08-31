import { createHash } from "node:crypto";
import { expect, test } from "vitest";
import {
  iss002HarnessPaths,
  iss002TestBundlePaths,
} from "../../packages/conformance/src/stable-bundles.js";
import * as c from "../../packages/contracts/src/index.js";

const schema = "resource-reclaim-receipt/v1";
const id = (n: number) => `01900000-0000-7000-8000-${n.toString(16).padStart(12, "0")}`;
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const raw = () => Uint8Array.from([0, 255, 65]);
const stdout = () => Uint8Array.from([255, 0]);
const stderr = () => Uint8Array.from([97]);
const ref = (value: Uint8Array) => ({
  byteLength: String(value.byteLength),
  contentDigest: sha(value),
});
const value = (hex: string | null) =>
  hex === null ? { kind: "ABSENT" } : { bytes: hex, kind: "PRESENT" };

// Fixed stdlib-only golden. The digest is over the full domain-separated frame,
// not the canonical JSON bytes alone.
const golden = {
  text: '{"contextDigest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","cycleId":"01900000-0000-7000-8000-000000000001","observations":[],"outcome":{"kind":"NO_ALLOCATION"},"process":{"kind":"NOT_LAUNCHED"},"reclaimTransactionId":"01900000-0000-7000-8000-000000000002","schemaVersion":"resource-reclaim-receipt/v1"}\n',
  digest: "9dc6f80827a0d62d5df324a2594ddb1b8f4b38123475064872cafb5ca888c7d6",
  frameHex:
    "6f726368657374726174696f6e2d706c6174666f726d007265736f757263652d7265636c61696d2d726563656970742f763100000000010700000000000001497b22636f6e74657874446967657374223a2261616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161222c226379636c654964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303031222c226f62736572766174696f6e73223a5b5d2c226f7574636f6d65223a7b226b696e64223a224e4f5f414c4c4f434154494f4e227d2c2270726f63657373223a7b226b696e64223a224e4f545f4c41554e43484544227d2c227265636c61696d5472616e73616374696f6e4964223a2230313930303030302d303030302d373030302d383030302d303030303030303030303032222c22736368656d6156657273696f6e223a227265736f757263652d7265636c61696d2d726563656970742f7631227d0a",
} as const;

function moduleInput() {
  const configurationProvenance = {
    adapterId: "fixture.adapter",
    capabilityNames: ["work.read"],
    fieldSources: {
      adapterId: "PROJECT",
      capabilityNames: "PROJECT",
      leaseFreshnessMs: "PROJECT",
      maximumSessionMs: "PROJECT",
      projectId: "PROJECT",
      stateRoot: "DEFAULT",
      wallClockSkewMs: "PROJECT",
    },
    leaseFreshnessMs: 30_000,
    maximumSessionMs: 3_600_000,
    projectId: id(1),
    projectRoot: `<redacted:path:${"b".repeat(64)}>`,
    schemaVersion: "configuration-provenance/v1",
    stateRoot: `<redacted:path:${"c".repeat(64)}>`,
    wallClockSkewMs: 1_000,
  };
  const adapterConfiguration = {
    adapterId: "fixture.adapter",
    adapterVersion: "1.2.3",
    capabilityNames: ["work.read"],
    engineVersion: "0.0.0",
    projectId: id(1),
    schemaVersion: "adapter-configuration/v1",
  };
  const cycleRequest = {
    adapterId: adapterConfiguration.adapterId,
    allowedModuleIds: ["fixture.module"],
    cycleId: id(3),
    schemaVersion: "cycle-request/v1",
    sessionRequest: {
      configurationPathsDigest: "c".repeat(64),
      configurationProvenanceDigest: c.canonicalDigest(configurationProvenance),
      configurationSourceDigest: "b".repeat(64),
      schemaVersion: "session-acquire-request/v1",
      sessionId: id(6),
    },
  };
  const projectFacts = {
    adapterConfigurationDigest: c.canonicalDigest(adapterConfiguration),
    frontier: [
      {
        capabilityNames: ["work.read"],
        immutableSubjectDigest: "a".repeat(64),
        readiness: "READY",
        workId: id(2),
      },
    ],
    frontierDigest: "",
    observationId: id(4),
    observedAt: "2026-08-31T01:00:00.000Z",
    projectId: id(1),
    schemaVersion: "project-facts/v1",
    state: "COMPLETE",
  };
  projectFacts.frontierDigest = c.canonicalDigest(projectFacts.frontier);
  const policyFacts = {
    adapterConfigurationDigest: c.canonicalDigest(adapterConfiguration),
    decisions: [{ capabilityName: "work.read", trip: "TRIP" }],
    observationId: id(5),
    observedAt: "2026-08-31T01:00:00.001Z",
    policyVersion: "1.2.3",
    projectFactsDigest: c.canonicalDigest(projectFacts),
    projectId: id(1),
    schemaVersion: "project-breaker-facts/v1",
    state: "COMPLETE",
  };
  const descriptor = {
    abi: "orchestration-module/v1",
    actions: [
      {
        actionKind: "fixture.direct",
        capabilityName: "work.read",
        requestedRole: "observer",
        reviewRequired: false,
        workerRequired: false,
      },
      {
        actionKind: "fixture.inspect",
        capabilityName: "work.read",
        requestedRole: "observer",
        reviewRequired: false,
        workerRequired: true,
      },
    ],
    compatibility: [
      {
        adapterId: "fixture.adapter",
        adapterVersion: "1.2.3",
        engineVersion: "0.0.0",
        policyVersion: "1.2.3",
      },
    ],
    dispatchCatalog: c.dispatchDirectiveKinds
      .filter((kind) => kind !== "OPERATOR_ACTION")
      .map((directiveKind) => ({
        actionKind: "fixture.inspect",
        capabilityName: "work.read",
        code: directiveKind.toLowerCase(),
        directiveKind,
        planAccessor: "IMMUTABLE_SUBJECT_DIGEST",
        templateId: `template.${directiveKind.toLowerCase()}`,
      })),
    dispositionCodes: ["decision.done"],
    inputSchemas: ["module-plan-input/v1"],
    moduleId: "fixture.module",
    moduleVersion: "1.0.0",
    outputSchemas: ["module-action-plan/v1", "module-no-action/v1"],
    schemaVersion: "module-descriptor/v1",
  };
  return {
    adapterConfiguration,
    configurationProvenance,
    cycleRequest,
    descriptor,
    policyFacts,
    projectFacts,
    reviewSubject: null,
    schemaVersion: "module-plan-input/v1",
  };
}

function action(input: ReturnType<typeof moduleInput>, worker: boolean) {
  const actionKind = worker ? "fixture.inspect" : "fixture.direct";
  const actionCore = {
    actionKind,
    capabilityName: "work.read",
    immutableSubjectDigest: input.projectFacts.frontier[0]!.immutableSubjectDigest,
    moduleDescriptorDigest: c.computeModuleDescriptorDigest(input.descriptor),
    requestedRole: "observer",
    schemaVersion: "dispatch-action-core/v1",
  };
  return {
    actionCore,
    dispatchBrief: worker
      ? {
          action: {
            actionCoreDigest: c.computeDispatchActionCoreDigest(actionCore),
            actionKind,
            capabilityName: "work.read",
            immutableSubjectDigest: actionCore.immutableSubjectDigest,
            moduleDescriptorDigest: actionCore.moduleDescriptorDigest,
            schemaVersion: "dispatch-brief-action/v1",
          },
          directives: c.dispatchDirectiveKinds.map((directiveKind) => ({
            code: directiveKind === "OPERATOR_ACTION" ? null : directiveKind.toLowerCase(),
            directiveKind,
            presence: directiveKind === "OPERATOR_ACTION" ? "ABSENT" : "PRESENT",
            schemaVersion: "dispatch-brief-directive/v1",
            subjectDigest: actionCore.immutableSubjectDigest,
          })),
          footprint: [
            {
              access: "READ",
              resourceIdentityDigest: actionCore.immutableSubjectDigest,
              schemaVersion: "dispatch-brief-resource/v1",
            },
          ],
          role: "observer",
          schemaVersion: "dispatch-brief/v1",
        }
      : null,
    inputDigest: c.computeModulePlanInputDigest(input),
    schemaVersion: "module-action-plan/v1",
    workId: input.projectFacts.frontier[0]!.workId,
  };
}

function route(
  input: ReturnType<typeof moduleInput>,
  plan: ReturnType<typeof action>,
  worker: boolean,
) {
  const identity = {
    capabilityNames: ["work.read"],
    hostRendererArtifactDigest: "1".repeat(64),
    schemaVersion: "worker-host-identity/v1",
  };
  const mapping = worker
    ? [
        {
          ...identity,
          schemaVersion: "worker-host-renderer-artifact/v1",
          workerHostIdentityDigest: c.computeWorkerHostIdentityDigest(identity),
        },
      ]
    : null;
  const selected = {
    actionPlanDigest: c.computeModuleActionPlanDigest(plan),
    hostMappingDigest: mapping === null ? null : c.computeRouteMappingDigest(mapping),
    outcome:
      mapping === null
        ? { kind: "NO_WORKER" }
        : { kind: "SELECTED", workerHostIdentityDigest: mapping[0]!.workerHostIdentityDigest },
    schemaVersion: "route-selection/v1",
  };
  expect(c.validateRouteSelectionBinding(input, plan, mapping, selected).ok).toBe(true);
  return { mapping, selected };
}

function cyclePlan(input: ReturnType<typeof moduleInput>) {
  return {
    protocol: "routine-cycle/v1",
    request: copy(input.cycleRequest),
    schemaVersion: "cycle-plan/v1",
  };
}

function inspectionHealth(
  input: ReturnType<typeof moduleInput>,
  outcome: "HEALTHY" | "REFUSED" | "UNKNOWN" = "HEALTHY",
) {
  if (outcome === "UNKNOWN")
    return {
      holderSessionId: null,
      leaseState: "UNKNOWN",
      observedAt: null,
      outcome,
      reason: "STATE_UNREADABLE",
      schemaVersion: "session-health/v1",
      step: null,
      targetSessionId: input.cycleRequest.sessionRequest.sessionId,
    };
  return {
    holderSessionId: input.cycleRequest.sessionRequest.sessionId,
    leaseState: "HELD_FRESH",
    observedAt: "2026-08-31T01:00:00.500Z",
    outcome,
    reason: outcome === "HEALTHY" ? null : "CONFIGURATION_MISMATCH",
    schemaVersion: "session-health/v1",
    step: null,
    targetSessionId: input.cycleRequest.sessionRequest.sessionId,
  };
}

function originHealth(input: ReturnType<typeof moduleInput>) {
  return {
    ...inspectionHealth(input, "UNKNOWN"),
    step: {
      cycleId: input.cycleRequest.cycleId,
      inputDigest: c.computeCycleRequestDigest(input.cycleRequest),
      kind: "session.verify",
      ordinal: "1",
      predecessorJournalDigest: null,
    },
  };
}

function preflightFixture(worker: boolean) {
  const input = moduleInput();
  const plan = action(input, worker);
  const routed = route(input, plan, worker);
  const observation = {
    facts: { ...copy(input.projectFacts), observationId: id(90) },
    kind: "PROJECT",
  };
  const preflight = {
    actionPlanDigest: c.computeModuleActionPlanDigest(plan),
    observationDigest: c.computeProjectPreflightObservationDigest(observation),
    outcome: { kind: "ELIGIBLE" },
    routeDigest: c.computeRouteSelectionDigest(routed.selected),
    schemaVersion: "project-preflight/v1",
  };
  return { input, plan, ...routed, observation, preflight };
}

function skip(
  cycleId: string,
  ordinal: number,
  inputDigest: string,
  reason: "no-allocation" | "no-worker" | "no-review" | "no-mutation" | "prior-known-terminal",
) {
  return {
    reason,
    schemaVersion: "routine-step-skip/v1",
    step: {
      cycleId,
      inputDigest,
      kind: c.routineStepKinds[String(ordinal) as keyof typeof c.routineStepKinds],
      ordinal: String(ordinal),
      predecessorJournalDigest: "f".repeat(64),
    },
  };
}

function skipChain(
  cycleId: string,
  ordinals: readonly number[],
  firstDigest: string,
  reason: "no-mutation" | "prior-known-terminal",
) {
  let prior = firstDigest;
  return ordinals.map((ordinal) => {
    const row = skip(cycleId, ordinal, prior, reason);
    prior = c.computeRoutineStepSkipDigest(row);
    return row;
  });
}

function workerFixture() {
  const upstream = preflightFixture(true);
  const planHealth = inspectionHealth(upstream.input);
  const rendered = raw();
  const dispatchPlan = {
    actionPlanDigest: c.computeModuleActionPlanDigest(upstream.plan),
    attemptId: id(9),
    outcome: {
      credentials: { kind: "NONE" },
      hostRendererArtifactDigest: upstream.mapping![0]!.hostRendererArtifactDigest,
      kind: "PLANNED",
      renderedInput: ref(rendered),
      resourceIntents: [
        { owner: "ADAPTER", resourceIdentityDigest: "1".repeat(64) },
        { owner: "HOST", resourceIdentityDigest: "2".repeat(64) },
      ],
      workerHostIdentityDigest: upstream.mapping![0]!.workerHostIdentityDigest,
    },
    preflightDigest: c.computeProjectPreflightDigest(upstream.preflight),
    reviewRequestDigest: null,
    routeDigest: c.computeRouteSelectionDigest(upstream.selected),
    schemaVersion: "dispatch-plan/v1",
    sessionHealthDigest: c.computeSessionHealthDigest(planHealth),
  };
  const launch = {
    attemptId: dispatchPlan.attemptId,
    dispatchPlanDigest: c.computeDispatchPlanDigest(dispatchPlan),
    observedAt: "2026-08-31T01:00:01.000Z",
    outcome: { kind: "LIVE" },
    ownership: "PUBLISHED",
    processes: {
      completeness: "COMPLETE",
      entries: [
        { parentProcessId: null, processId: id(50), state: "LIVE" },
        { parentProcessId: id(50), processId: id(51), state: "LIVE" },
      ],
    },
    resources: dispatchPlan.outcome.resourceIntents.map((intent, index) => ({
      ...copy(intent),
      allocationId: id(30 + index),
      ownerTransactionId: dispatchPlan.attemptId,
      state: "ALLOCATED",
    })),
    schemaVersion: "worker-launch-receipt/v1",
  };
  const out = stdout(),
    err = stderr();
  const terminal = {
    attemptId: dispatchPlan.attemptId,
    capture: {
      stderr: { content: ref(err), kind: "TRUNCATED" },
      stdout: { content: ref(out), kind: "COMPLETE" },
    },
    dispatchPlanDigest: c.computeDispatchPlanDigest(dispatchPlan),
    launchReceiptDigest: c.computeWorkerLaunchReceiptDigest(launch),
    observedAt: "2026-08-31T01:00:02.000Z",
    outcome: { exit: { kind: "EXIT_CODE", value: "0" }, kind: "EXITED" },
    processes: {
      completeness: "COMPLETE",
      entries: launch.processes.entries.map((row) => ({ ...copy(row), state: "DEAD" })),
    },
    schemaVersion: "worker-terminal-receipt/v1",
  };
  const dispositionInput = {
    actionPlan: copy(upstream.plan),
    moduleInput: copy(upstream.input),
    preflight: copy(upstream.preflight),
    review: null,
    route: copy(upstream.selected),
    skips: [
      skip(
        upstream.input.cycleRequest.cycleId,
        10,
        c.computeWorkerTerminalReceiptDigest(terminal),
        "no-review",
      ),
    ],
    worker: {
      launch,
      plan: dispatchPlan,
      resultSubject: null,
      terminal,
    },
  };
  const disposition = {
    actionPlanDigest: c.computeModuleActionPlanDigest(dispositionInput.actionPlan),
    code: "decision.done",
    inputDigest: c.computeDispositionInputDigest(dispositionInput),
    outcome: { kind: "NO_ACTION" },
    schemaVersion: "action-disposition/v1",
    subjectDigest: dispositionInput.actionPlan.actionCore.immutableSubjectDigest,
    subjectKind: "ACTION",
  };
  const context = {
    adapterConfiguration: copy(upstream.input.adapterConfiguration),
    configurationProvenance: copy(upstream.input.configurationProvenance),
    cyclePlan: cyclePlan(upstream.input),
    origin: {
      disposition,
      dispositionInput,
      followUp: null,
      kind: "ACTION",
      mutation: null,
    },
    sessionHealth: inspectionHealth(upstream.input),
    skips: skipChain(
      upstream.input.cycleRequest.cycleId,
      [12, 13],
      c.computeActionDispositionDigest(disposition),
      "no-mutation",
    ),
  };
  expect(
    c.validateDispatchPlanBinding(
      upstream.input,
      upstream.plan,
      upstream.mapping,
      upstream.selected,
      upstream.observation,
      upstream.preflight,
      context.cyclePlan,
      planHealth,
      null,
      rendered,
      dispatchPlan,
    ).ok,
  ).toBe(true);
  expect(c.validateWorkerLaunchReceiptBinding(dispatchPlan, launch).ok).toBe(true);
  expect(c.validateWorkerTerminalReceiptBinding(dispatchPlan, launch, out, err, terminal).ok).toBe(
    true,
  );
  expect(c.validateActionDispositionBinding(dispositionInput, out, err, disposition).ok).toBe(true);
  return { context, rendered, out, err, launch, terminal };
}

function workerlessMutationFixture() {
  const upstream = preflightFixture(false);
  const dispositionInput = {
    actionPlan: copy(upstream.plan),
    moduleInput: copy(upstream.input),
    preflight: copy(upstream.preflight),
    review: null,
    route: copy(upstream.selected),
    skips: [] as ReturnType<typeof skip>[],
    worker: null,
  };
  let prior = c.computeProjectPreflightDigest(upstream.preflight);
  for (const [ordinal, reason] of [
    [7, "no-allocation"],
    [8, "no-worker"],
    [9, "no-worker"],
    [10, "no-review"],
  ] as const) {
    const row = skip(upstream.input.cycleRequest.cycleId, ordinal, prior, reason);
    dispositionInput.skips.push(row);
    prior = c.computeRoutineStepSkipDigest(row);
  }
  const disposition = {
    actionPlanDigest: c.computeModuleActionPlanDigest(dispositionInput.actionPlan),
    code: "decision.done",
    inputDigest: c.computeDispositionInputDigest(dispositionInput),
    outcome: { kind: "APPLY", operation: "PROJECT" },
    schemaVersion: "action-disposition/v1",
    subjectDigest: dispositionInput.actionPlan.actionCore.immutableSubjectDigest,
    subjectKind: "ACTION",
  };
  const request = {
    actionPlanDigest: c.computeModuleActionPlanDigest(dispositionInput.actionPlan),
    adapterConfigurationDigest: c.canonicalDigest(upstream.input.adapterConfiguration),
    dispositionDigest: c.computeActionDispositionDigest(disposition),
    schemaVersion: "project-mutation-request/v1",
    sourceCycleId: upstream.input.cycleRequest.cycleId,
    subjectDigest: disposition.subjectDigest,
    subjectKind: "ACTION",
    transactionId: id(20),
  };
  const effects = [
    { after: value("00"), before: value(null), kind: "COMPARE_REPLACE", resourceId: "a.create" },
    { after: value(null), before: value("aa"), kind: "COMPARE_REPLACE", resourceId: "b.remove" },
  ];
  const observed = (n: number, values = effects.map((effect) => effect.before)) => ({
    adapterConfigurationDigest: c.canonicalDigest(upstream.input.adapterConfiguration),
    observationId: id(100 + n),
    observedAt: `2026-08-31T01:00:0${n}.000Z`,
    result: {
      kind: "COMPLETE",
      projectFacts: {
        ...copy(upstream.input.projectFacts),
        observationId: id(110 + n),
        observedAt: `2026-08-31T01:00:0${n}.000Z`,
      },
      resources: effects.map((effect, index) => ({
        resourceId: effect.resourceId,
        value: copy(values[index]),
      })),
    },
  });
  const dry = observed(1),
    before = observed(2),
    after = observed(
      3,
      effects.map((effect) => effect.after),
    );
  const intents = effects.map((_, index) => ({
    owner: "ADAPTER",
    resourceIdentityDigest: String(index + 3).repeat(64),
  }));
  const plan = {
    observationDigest: c.computeProjectMutationObservationDigest(dry),
    outcome: { effects, kind: "PLANNED", resourceIntents: intents },
    requestDigest: c.computeProjectMutationRequestDigest(request),
    schemaVersion: "project-mutation-plan/v1",
    transactionId: request.transactionId,
  };
  const applyReceipt = {
    afterObservationDigest: c.computeProjectMutationObservationDigest(after),
    beforeObservationDigest: c.computeProjectMutationObservationDigest(before),
    completedEffectCount: "2",
    outcome: { kind: "APPLIED" },
    phase: "AFTER_WRITE",
    planDigest: c.computeProjectMutationPlanDigest(plan),
    requestDigest: c.computeProjectMutationRequestDigest(request),
    resources: intents.map((intent, index) => ({
      ...copy(intent),
      allocationId: id(70 + index),
      ownerTransactionId: request.transactionId,
      state: "ALLOCATED",
    })),
    schemaVersion: "project-apply-receipt/v1",
    transactionId: request.transactionId,
  };
  const context = {
    adapterConfiguration: copy(upstream.input.adapterConfiguration),
    configurationProvenance: copy(upstream.input.configurationProvenance),
    cyclePlan: cyclePlan(upstream.input),
    origin: {
      disposition,
      dispositionInput,
      followUp: null,
      kind: "ACTION",
      mutation: {
        afterObservation: after,
        beforeObservation: before,
        dryObservation: dry,
        plan,
        receipt: applyReceipt,
        request,
      },
    },
    sessionHealth: inspectionHealth(upstream.input),
    skips: [],
  };
  expect(c.validateActionDispositionBinding(dispositionInput, null, null, disposition).ok).toBe(
    true,
  );
  expect(
    c.validateProjectMutationRequestBinding(dispositionInput, null, null, disposition, request).ok,
  ).toBe(true);
  expect(
    c.validateProjectMutationPlanBinding(
      dispositionInput,
      null,
      null,
      disposition,
      request,
      dry,
      plan,
    ).ok,
  ).toBe(true);
  expect(
    c.validateProjectApplyReceiptBinding(
      dispositionInput,
      null,
      null,
      disposition,
      request,
      dry,
      plan,
      c.computeProjectMutationPlanDigest(plan),
      before,
      after,
      applyReceipt,
    ).ok,
  ).toBe(true);
  return { context, allocations: applyReceipt.resources };
}

function observation(n: number, hex: string | null = "00") {
  return {
    observationId: id(1_000 + n),
    observedAt: "2026-08-31T01:00:04.000Z",
    result: { kind: "COMPLETE", value: value(hex) },
  };
}

function unknownObservation(reason = "OBSERVATION_UNAVAILABLE") {
  return {
    observationId: null,
    observedAt: null,
    result: { kind: "UNKNOWN", reason },
  };
}

function ownerRow(
  allocation: ReturnType<typeof workerFixture>["launch"]["resources"][number],
  source: "DISPATCH" | "MUTATION",
  reclaimTransactionId: string,
  outcome: Record<string, unknown>,
  index: number,
) {
  const before = observation(index * 2, "00");
  const after = observation(index * 2 + 1, null);
  return JSON.parse(
    JSON.stringify({
      after: outcome.kind === "RECLAIMED" ? after : null,
      allocation: copy(allocation),
      before,
      outcome: copy(outcome),
      reclaimTransactionId,
      source,
    }),
  );
}

function closedProcess(fixture: ReturnType<typeof workerFixture>) {
  return {
    handles: { process: "CLOSED", stderr: "CLOSED", stdin: "CLOSED", stdout: "CLOSED" },
    kind: "OBSERVED",
    observationId: id(900),
    observedAt: "2026-08-31T01:00:03.000Z",
    processes: copy(fixture.terminal.processes),
  };
}

function receiptForWorker(fixture: ReturnType<typeof workerFixture>) {
  const reclaimTransactionId = id(800);
  return JSON.parse(
    JSON.stringify({
      contextDigest: c.computeResourceReclaimContextDigest(fixture.context),
      cycleId: fixture.context.cyclePlan.request.cycleId,
      observations: fixture.launch.resources.map((allocation, index) =>
        ownerRow(allocation, "DISPATCH", reclaimTransactionId, { kind: "RECLAIMED" }, index + 1),
      ),
      outcome: { kind: "RECLAIMED" },
      process: closedProcess(fixture),
      reclaimTransactionId,
      schemaVersion: "resource-reclaim-receipt/v1",
    }),
  );
}

function receiptForMutation(fixture: ReturnType<typeof workerlessMutationFixture>) {
  const reclaimTransactionId = id(801);
  return JSON.parse(
    JSON.stringify({
      contextDigest: c.computeResourceReclaimContextDigest(fixture.context),
      cycleId: fixture.context.cyclePlan.request.cycleId,
      observations: fixture.allocations.map((allocation, index) =>
        ownerRow(allocation, "MUTATION", reclaimTransactionId, { kind: "RECLAIMED" }, index + 20),
      ),
      outcome: { kind: "RECLAIMED" },
      process: { kind: "NOT_LAUNCHED" },
      reclaimTransactionId,
      schemaVersion: "resource-reclaim-receipt/v1",
    }),
  );
}

function bindWorker(
  fixture: ReturnType<typeof workerFixture>,
  receipt: unknown,
  rendered: unknown = null,
  out: unknown = fixture.out,
  err: unknown = fixture.err,
) {
  return c.validateResourceReclaimReceiptBinding(fixture.context, rendered, out, err, receipt);
}

test("pins canonical bytes, full frame, digest, generic parser and serializer routing", () => {
  const row = JSON.parse(golden.text),
    bytes = new TextEncoder().encode(golden.text);
  expect(c.parseResourceReclaimReceipt(row)).toEqual({ ok: true, value: row });
  expect(c.parseResourceReclaimContract(schema, row)).toEqual({ ok: true, value: row });
  expect(c.parseContract(schema, row)).toEqual({ ok: true, value: row });
  expect(c.parseCanonicalContractBytes(schema, bytes)).toEqual({ ok: true, value: row });
  expect(c.serializeContract(schema, row)).toEqual({ ok: true, bytes, digest: golden.digest });
  expect(c.computeResourceReclaimReceiptDigest(row)).toBe(golden.digest);
  expect(Buffer.from(c.framedBytes(schema, [c.frame.canonical(row)])).toString("hex")).toBe(
    golden.frameHex,
  );
  expect(sha(Buffer.from(golden.frameHex, "hex"))).toBe(golden.digest);
  expect(sha(golden.text)).not.toBe(golden.digest);
  expect(c.resourceReclaimSchemaVersions).toEqual([schema]);
  expect(c.schemaVersions).toContain(schema);
  expect(c.schemaVocabularyDefinitions[schema]?.fields).toEqual(
    c.resourceReclaimSchemaFields.receipt,
  );
  expect(iss002HarnessPaths).toContain("packages/contracts/src/resource-reclaim.ts");
  expect(iss002TestBundlePaths).toContain("test/contracts/resource-reclaim.test.ts");
});

test("rejects malformed persisted forms and future or duplicate record members", () => {
  const encoder = new TextEncoder();
  const forms = [
    golden.text.slice(0, -1),
    ` ${golden.text}`,
    golden.text.replace(/\n$/, "\r\n"),
    `${golden.text}\n`,
    golden.text.replace(
      '{"contextDigest":',
      `{"contextDigest":"${"0".repeat(64)}","contextDigest":`,
    ),
    golden.text.replace(/}\n$/, ',"future":true}\n'),
  ];
  for (const text of forms)
    expect(c.parseCanonicalContractBytes(schema, encoder.encode(text)).ok).toBe(false);
  expect(
    c.parseCanonicalContractBytes(
      schema,
      Uint8Array.from([0xef, 0xbb, 0xbf, ...encoder.encode(golden.text)]),
    ).ok,
  ).toBe(false);
  expect(c.parseResourceReclaimContract("resource-reclaim-receipt/v2", {})).toBeNull();
});

test("closes receipt, process, owner and observation unions with exact nullability", () => {
  const base = JSON.parse(golden.text);
  for (const field of c.resourceReclaimSchemaFields.receipt) {
    const missing = copy(base);
    delete missing[field];
    expect(c.parseResourceReclaimReceipt(missing).ok).toBe(false);
  }
  expect(c.parseResourceReclaimReceipt({ ...base, future: true }).ok).toBe(false);
  for (const outcome of [
    { kind: "NO_ALLOCATION" },
    { kind: "RECLAIMED" },
    ...["HANDLES_OPEN", "OWNER_REFUSED", "SESSION_UNHEALTHY"].map((reason) => ({
      kind: "RETAINED",
      reason,
    })),
    ...c.reclaimReceiptUnknownReasons.map((reason) => ({ kind: "UNKNOWN", reason })),
  ])
    expect(c.parseResourceReclaimReceipt({ ...base, outcome }).ok).toBe(true);

  for (const process of [
    { kind: "NOT_LAUNCHED" },
    ...["OBSERVATION_UNAVAILABLE", "IDENTITY_CONFLICT", "HANDLE_LOST"].map((reason) => ({
      kind: "UNKNOWN",
      reason,
    })),
    {
      handles: {
        process: "NOT_CREATED",
        stderr: "CLOSED",
        stdin: "OPEN",
        stdout: "UNKNOWN",
      },
      kind: "OBSERVED",
      observationId: id(400),
      observedAt: "2026-08-31T01:00:04.000Z",
      processes: { completeness: "COMPLETE", entries: [] },
    },
  ])
    expect(c.parseReclaimProcessObservation(process).ok).toBe(true);

  const allocation = {
    allocationId: id(410),
    owner: "ADAPTER",
    ownerTransactionId: id(411),
    resourceIdentityDigest: "4".repeat(64),
    state: "ALLOCATED",
  };
  const tx = id(412);
  expect(
    c.parseReclaimOwnerRow(ownerRow(allocation, "DISPATCH", tx, { kind: "RECLAIMED" }, 40)).ok,
  ).toBe(true);
  for (const reason of ["HANDLES_OPEN", "OWNER_REFUSED", "PROCESS_LIVE", "SESSION_UNHEALTHY"])
    expect(
      c.parseReclaimOwnerRow(ownerRow(allocation, "DISPATCH", tx, { kind: "RETAINED", reason }, 41))
        .ok,
    ).toBe(true);
  for (const reason of c.reclaimOwnerUnknownReasons)
    for (const phase of ["BEFORE_RECLAIM", "RECLAIMING", "AFTER_RECLAIM"]) {
      const row = ownerRow(allocation, "DISPATCH", tx, { kind: "UNKNOWN", phase, reason }, 42);
      row.after = phase === "BEFORE_RECLAIM" ? null : unknownObservation();
      expect(c.parseReclaimOwnerRow(row).ok).toBe(true);
    }
  const unknownAllocation = {
    ...allocation,
    allocationId: null,
    state: "UNKNOWN",
  };
  const unknownRow = ownerRow(
    unknownAllocation,
    "DISPATCH",
    tx,
    { kind: "UNKNOWN", phase: "BEFORE_RECLAIM", reason: "AUTHORITY_UNPROVEN" },
    43,
  );
  unknownRow.after = null;
  unknownRow.before = unknownObservation();
  expect(c.parseReclaimOwnerRow(unknownRow).ok).toBe(true);
  expect(
    c.parseReclaimOwnerRow({
      ...unknownRow,
      outcome: { kind: "RECLAIMED" },
    }).ok,
  ).toBe(false);
});

test("bounds complete retained values and keeps unsupported resources opaque", () => {
  expect(c.parseReclaimOwnerObservation(observation(60, "00".repeat(4096))).ok).toBe(true);
  expect(c.parseReclaimOwnerObservation(observation(61, "00".repeat(4097))).ok).toBe(false);
  for (const reason of [
    "OBSERVATION_UNAVAILABLE",
    "OBSERVATION_INVALID",
    "IDENTITY_CONFLICT",
    "UNSUPPORTED_RESOURCE",
  ]) {
    const unavailable = unknownObservation(reason);
    expect(c.parseReclaimOwnerObservation(unavailable).ok).toBe(true);
    expect(Object.keys(unavailable.result).sort()).toEqual(["kind", "reason"]);
  }
  expect(c.resourceReclaimSchemaFields.observation).not.toContain("path");
  expect(c.resourceReclaimSchemaFields.owner).not.toContain("workspace");
});

test("admits exactly the bounded combined 256 dispatch plus 64 mutation census", () => {
  const reclaimTransactionId = id(500);
  const rows = (source: "DISPATCH" | "MUTATION", count: number, offset: number) =>
    Array.from({ length: count }, (_, index) => ({
      after: null,
      allocation: {
        allocationId: null,
        owner: "ADAPTER",
        ownerTransactionId: id(2_000 + offset + index),
        resourceIdentityDigest: (offset + index).toString(16).padStart(64, "0"),
        state: "NOT_ALLOCATED",
      },
      before: observation(70 + offset + index, null),
      outcome: { kind: "NOT_ALLOCATED" },
      reclaimTransactionId,
      source,
    }));
  const observations = [...rows("DISPATCH", 256, 0), ...rows("MUTATION", 64, 1_000)];
  const receipt = {
    contextDigest: "a".repeat(64),
    cycleId: id(501),
    observations,
    outcome: { kind: "NO_ALLOCATION" },
    process: { kind: "NOT_LAUNCHED" },
    reclaimTransactionId,
    schemaVersion: "resource-reclaim-receipt/v1",
  };
  expect(observations).toHaveLength(320);
  expect(observations.every((row) => c.parseReclaimOwnerRow(row).ok)).toBe(true);
  expect(c.parseResourceReclaimReceipt(receipt).ok).toBe(true);
  const over = copy(receipt);
  over.observations.push(rows("MUTATION", 1, 2_000)[0]!);
  expect(c.parseResourceReclaimReceipt(over).ok).toBe(false);
  const duplicate = copy(receipt);
  duplicate.observations[1] = copy(duplicate.observations[0]);
  expect(c.parseResourceReclaimReceipt(duplicate).ok).toBe(false);
});

test("parses all six retained context origins without converting shape to authority", () => {
  const mutation = workerlessMutationFixture();
  const worker = workerFixture();
  const input = mutation.context.origin.dispositionInput.moduleInput;
  const breakerReceipt = {
    adapterConfigurationDigest: c.canonicalDigest(input.adapterConfiguration),
    cycleId: input.cycleRequest.cycleId,
    cycleRequestDigest: c.computeCycleRequestDigest(input.cycleRequest),
    operations: [],
    policyFactsDigest: c.canonicalDigest(input.policyFacts),
    policyIdentity: {
      adapterId: input.adapterConfiguration.adapterId,
      adapterVersion: input.adapterConfiguration.adapterVersion,
      policyVersion: input.policyFacts.policyVersion,
    },
    priorReceiptDigest: null,
    result: {
      blockedCapabilityNames: ["work.read"],
      kind: "UNKNOWN",
      reason: "HISTORY_UNPROVEN",
    },
    schemaVersion: "breaker-receipt/v1",
    sessionId: input.cycleRequest.sessionRequest.sessionId,
  };
  const origins = [
    { health: originHealth(input), kind: "SESSION" },
    { facts: copy(input.projectFacts), kind: "SNAPSHOT" },
    {
      facts: copy(input.projectFacts),
      kind: "BREAKER",
      policyFacts: copy(input.policyFacts),
      prior: null,
      receipt: breakerReceipt,
    },
    {
      input: copy(input),
      kind: "MODULE",
      result: {
        inputDigest: c.computeModulePlanInputDigest(input),
        outcome: "NO_ACTION",
        reason: "NO_ELIGIBLE_ACTION",
        schemaVersion: "module-no-action/v1",
      },
    },
    {
      action: copy(worker.context.origin.dispositionInput.actionPlan),
      input: copy(worker.context.origin.dispositionInput.moduleInput),
      kind: "PREPARATION",
      launch: copy(worker.launch),
      mapping: null,
      observation: null,
      plan: copy(worker.context.origin.dispositionInput.worker.plan),
      preflight: copy(worker.context.origin.dispositionInput.preflight),
      reviewRequest: null,
      route: copy(worker.context.origin.dispositionInput.route),
      sessionHealth: inspectionHealth(input),
      terminal: copy(worker.terminal),
    },
    copy(mutation.context.origin),
  ];
  for (const origin of origins) {
    const context = { ...copy(mutation.context), origin };
    expect(c.parseResourceReclaimContext(context).ok).toBe(true);
  }
  expect(origins.map((origin) => origin.kind)).toEqual([
    "SESSION",
    "SNAPSHOT",
    "BREAKER",
    "MODULE",
    "PREPARATION",
    "ACTION",
  ]);
});

test("binds exact context, raw captures, owner census and process closure", () => {
  const fixture = workerFixture(),
    receipt = receiptForWorker(fixture);
  expect(bindWorker(fixture, receipt)).toEqual({ ok: true, value: receipt });
  for (const [rendered, out, err] of [
    [raw(), fixture.out, fixture.err],
    [null, Uint8Array.from([0]), fixture.err],
    [null, fixture.out, null],
  ])
    expect(bindWorker(fixture, receipt, rendered, out, err).ok).toBe(false);
  const wrongContext = copy(fixture.context);
  wrongContext.cyclePlan.request.cycleId = id(999);
  expect(c.parseResourceReclaimContext(wrongContext).ok).toBe(true);
  expect(
    c.validateResourceReclaimReceiptBinding(wrongContext, null, fixture.out, fixture.err, receipt)
      .ok,
  ).toBe(false);
  const wrongOwner = copy(receipt);
  wrongOwner.observations[0].allocation.resourceIdentityDigest = "9".repeat(64);
  expect(c.parseResourceReclaimReceipt(wrongOwner).ok).toBe(true);
  expect(bindWorker(fixture, wrongOwner).ok).toBe(false);
  const omitted = copy(receipt);
  omitted.observations.pop();
  expect(c.parseResourceReclaimReceipt(omitted).ok).toBe(true);
  expect(bindWorker(fixture, omitted).ok).toBe(false);
});

test("keeps OPEN and REFUSED pre-owner guards global and effect-free", () => {
  const worker = workerFixture(),
    open = receiptForWorker(worker);
  open.process.handles.stdin = "OPEN";
  open.observations = open.observations.map((row) => ({
    ...row,
    after: null,
    outcome: { kind: "RETAINED", reason: "HANDLES_OPEN" },
  }));
  open.outcome = { kind: "RETAINED", reason: "HANDLES_OPEN" };
  expect(bindWorker(worker, open)).toEqual({ ok: true, value: open });
  const mixedOpen = copy(open);
  mixedOpen.observations[0] = ownerRow(
    worker.launch.resources[0],
    "DISPATCH",
    open.reclaimTransactionId,
    { kind: "RECLAIMED" },
    1,
  );
  mixedOpen.observations[1].outcome = {
    kind: "UNKNOWN",
    phase: "AFTER_RECLAIM",
    reason: "RECLAIM_UNPROVEN",
  };
  mixedOpen.observations[1].after = unknownObservation();
  mixedOpen.outcome = { kind: "UNKNOWN", reason: "RECLAIM_UNPROVEN" };
  expect(c.parseResourceReclaimReceipt(mixedOpen).ok).toBe(true);
  expect(bindWorker(worker, mixedOpen).ok).toBe(false);

  const mutation = workerlessMutationFixture();
  mutation.context.sessionHealth = inspectionHealth(
    mutation.context.origin.dispositionInput.moduleInput,
    "REFUSED",
  );
  const refused = receiptForMutation(mutation);
  refused.contextDigest = c.computeResourceReclaimContextDigest(mutation.context);
  refused.observations = refused.observations.map((row) => ({
    ...row,
    after: null,
    outcome: { kind: "RETAINED", reason: "SESSION_UNHEALTHY" },
  }));
  refused.outcome = { kind: "RETAINED", reason: "SESSION_UNHEALTHY" };
  expect(
    c.validateResourceReclaimReceiptBinding(mutation.context, null, null, null, refused),
  ).toEqual({ ok: true, value: refused });
  const mixedRefused = copy(refused);
  mixedRefused.observations[0] = ownerRow(
    mutation.allocations[0],
    "MUTATION",
    refused.reclaimTransactionId,
    { kind: "RECLAIMED" },
    20,
  );
  mixedRefused.observations[1].outcome = {
    kind: "UNKNOWN",
    phase: "AFTER_RECLAIM",
    reason: "RECLAIM_UNPROVEN",
  };
  mixedRefused.observations[1].after = unknownObservation();
  mixedRefused.outcome = { kind: "UNKNOWN", reason: "RECLAIM_UNPROVEN" };
  expect(c.parseResourceReclaimReceipt(mixedRefused).ok).toBe(true);
  expect(
    c.validateResourceReclaimReceiptBinding(mutation.context, null, null, null, mixedRefused).ok,
  ).toBe(false);
});

test("retains row-local uncertainty while unrelated healthy closed rows stay positive", () => {
  const fixture = workerFixture(),
    partial = receiptForWorker(fixture);
  partial.observations[1].outcome = {
    kind: "UNKNOWN",
    phase: "AFTER_RECLAIM",
    reason: "RECLAIM_UNPROVEN",
  };
  partial.observations[1].after = unknownObservation();
  partial.outcome = { kind: "UNKNOWN", reason: "RECLAIM_UNPROVEN" };
  expect(partial.observations[0].outcome).toEqual({ kind: "RECLAIMED" });
  expect(bindWorker(fixture, partial)).toEqual({ ok: true, value: partial });

  const unsupported = receiptForWorker(fixture);
  unsupported.observations[1].outcome = {
    kind: "UNKNOWN",
    phase: "BEFORE_RECLAIM",
    reason: "UNSUPPORTED_RESOURCE",
  };
  unsupported.observations[1].after = null;
  unsupported.observations[1].before = unknownObservation("UNSUPPORTED_RESOURCE");
  unsupported.outcome = { kind: "UNKNOWN", reason: "OWNER_UNPROVEN" };
  expect(bindWorker(fixture, unsupported)).toEqual({ ok: true, value: unsupported });
});
